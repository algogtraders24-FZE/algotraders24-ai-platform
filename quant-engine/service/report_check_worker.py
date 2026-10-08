"""
quant-engine/service/report_check_worker.py

Seller self-serve Phase 2 - the AT24 VPS worker behind "Checked from the seller's report".

What it does, per job:
  1. polls https://<site>/api/report-check/v1/claim (outbound HTTPS only - no inbound port, no tunnel);
  2. downloads the seller's MT5 Strategy Tester report from the short-lived signed URL it was handed;
  3. runs the existing, unmodified M2 evidence engine (ea-research/marketplace-research/m2-evidence-engine/evidence_engine.py)
     in a SEPARATE python process with a timeout - it only parses the report and recomputes the numbers from its own
     Deals table; it never runs anything from the file;
  4. posts a compact summary (never the trade list) to /api/report-check/v1/complete.

The server re-shapes whatever is posted (known typed fields only) before it is shown publicly, so a bug here cannot inject
text into a listing page. Standard library only.

Run:   python report_check_worker.py                 (loop; poll every REPORT_CHECK_POLL_SECONDS)
       python report_check_worker.py --file r.xlsx   (local test: parse one report and print the compact result)

Environment:
  REPORT_CHECK_WORKER_SECRET   required (same value as on Vercel)
  REPORT_CHECK_BASE_URL        default https://www.algotraders24.ai
  REPORT_CHECK_M2_DIR          folder holding evidence_engine.py (default: ../../ea-research/marketplace-research/m2-evidence-engine)
  REPORT_CHECK_POLL_SECONDS    default 20
  REPORT_CHECK_TIMEOUT_SECONDS default 900 (per report)
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Optional

SERVICE_DIR = Path(__file__).resolve().parent
DEFAULT_M2_DIR = SERVICE_DIR.parent.parent / "ea-research" / "marketplace-research" / "m2-evidence-engine"
M2_DIR = Path(os.environ.get("REPORT_CHECK_M2_DIR", str(DEFAULT_M2_DIR)))
BASE_URL = os.environ.get("REPORT_CHECK_BASE_URL", "https://www.algotraders24.ai").rstrip("/")
POLL_SECONDS = int(os.environ.get("REPORT_CHECK_POLL_SECONDS", "20"))
TIMEOUT_SECONDS = int(os.environ.get("REPORT_CHECK_TIMEOUT_SECONDS", "900"))
MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 800 * 1024 * 1024  # zip-bomb guard for .xlsx (a 50 MB report unpacks to a few hundred MB)

# These strings are the ONLY failure texts the server accepts (lib/marketplace/reportCheck.ts SAFE_FAILURE_REASONS).
R_NOT_REPORT = "This does not look like an MT5 Strategy Tester report (.xlsx or .html)."
R_NO_DEALS = "The report has no Deals table - export it with the Deals section included."
R_NO_TRADES = "The report has no closed trades."
R_TOO_LARGE = "The report is too large to read. Use a shorter test period."
R_TIMEOUT = "The report could not be read in time. Try a shorter test period."
R_GENERIC = "The report could not be read."


class CheckFailed(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _opt_float(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def build_result(evidence_doc: dict) -> dict:
    """Evidence JSON (M2 output) -> the compact public summary. Pure, no I/O."""
    ev = evidence_doc["evidence"]
    prov = ev.get("provenance", {}) or {}
    ms = ev.get("metricsSummary", {}) or {}
    dd = ms.get("maxDrawdown", {}) or {}
    assumptions = prov.get("executionAssumptions", {}) or {}
    cross = ev.get("reportCrossCheck", {}) or {}
    items = []
    for key, c in cross.items():
        if not isinstance(c, dict):
            continue
        items.append({
            "label": str(c.get("label") or key)[:40],
            "computed": _opt_float(c.get("computed")),
            "reportValue": _opt_float(c.get("reportValue")),
            "withinTolerance": c.get("withinTolerance") if isinstance(c.get("withinTolerance"), bool) else None,
        })
    return {
        "symbol": prov.get("symbol"),
        "broker": prov.get("broker"),
        "timeframe": prov.get("timeframe"),
        "periodStart": prov.get("periodStart"),
        "periodEnd": prov.get("periodEnd"),
        "initialDeposit": _opt_float(assumptions.get("initialDeposit")),
        "metrics": {
            "tradeCount": _opt_float(ms.get("tradeCount")),
            "netProfit": _opt_float(ms.get("netProfit")),
            "profitFactor": _opt_float(ms.get("profitFactor")),
            "winRate": _opt_float(ms.get("winRate")),
            "maxDrawdownPercent": _opt_float(dd.get("percent")),
            "maxDrawdownAbsolute": _opt_float(dd.get("absolute")),
            "recoveryFactor": _opt_float(ms.get("recoveryFactor")),
            "largestWin": _opt_float(ms.get("largestWin")),
            "largestLoss": _opt_float(ms.get("largestLoss")),
            "avgTrade": _opt_float(ms.get("avgTrade")),
        },
        "crossCheck": items,
    }


def _guard_xlsx(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as z:
            total = sum(i.file_size for i in z.infolist())
    except zipfile.BadZipFile:
        raise CheckFailed(R_NOT_REPORT)
    if total > MAX_UNCOMPRESSED_BYTES:
        raise CheckFailed(R_TOO_LARGE)


def _map_error(stderr: str) -> str:
    s = stderr.lower()
    if "no 'deals' section" in s or "no deals" in s:
        return R_NO_DEALS
    if "no worksheet" in s or "not a valid mt5" in s or "badzipfile" in s:
        return R_NOT_REPORT
    if "memoryerror" in s:
        return R_TOO_LARGE
    if "no closed" in s or "no trades" in s or "zero trades" in s or "empty" in s:
        return R_NO_TRADES
    return R_GENERIC


def check_report_file(report: Path) -> dict:
    """Run M2 on one report (separate process, timeout) and return the compact result. Raises CheckFailed."""
    ext = report.suffix.lower()
    if ext == ".xlsx":
        source = "xlsx"
        _guard_xlsx(report)
    elif ext in (".html", ".htm"):
        source = "deals"
    else:
        raise CheckFailed(R_NOT_REPORT)
    engine = M2_DIR / "evidence_engine.py"
    if not engine.exists():
        raise CheckFailed(R_GENERIC)
    out_dir = Path(tempfile.mkdtemp(prefix="rc_out_"))
    try:
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(engine), "--report", str(report), "--source", source, "--version-id", "SELLER-REPORT-CHECK", "--out-dir", str(out_dir)],
                capture_output=True, text=True, timeout=TIMEOUT_SECONDS, cwd=str(out_dir),
            )
        except subprocess.TimeoutExpired:
            raise CheckFailed(R_TIMEOUT)
        if proc.returncode != 0:
            raise CheckFailed(_map_error((proc.stderr or "") + (proc.stdout or "")))
        outputs = sorted(out_dir.glob("evidence_*.json"))
        if not outputs:
            raise CheckFailed(R_GENERIC)
        doc = json.loads(outputs[0].read_text(encoding="utf-8"))
        if not doc.get("trades"):
            raise CheckFailed(R_NO_TRADES)
        return build_result(doc)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


# --------------------------------------------------------------------------- transport


def _post(path: str, payload: dict, secret: str, timeout: int = 40) -> dict:
    req = urllib.request.Request(
        BASE_URL + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}", "User-Agent": "at24-report-check-worker/1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "code": f"HTTP_{e.code}"}


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "at24-report-check-worker/1"})
    size = 0
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_DOWNLOAD_BYTES:
                raise CheckFailed(R_TOO_LARGE)
            f.write(chunk)


def _log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def process_one(secret: str) -> bool:
    """Claim and process at most one job. Returns True when a job was handled (so the loop polls again immediately)."""
    claim = _post("/api/report-check/v1/claim", {}, secret)
    if not claim.get("ok"):
        _log(f"claim failed: {claim.get('code')}")
        return False
    job = claim.get("job")
    if not job:
        return False
    job_id = job["id"]
    _log(f"job {job_id}: {job.get('fileName')} ({job.get('sizeBytes')} bytes, attempt {job.get('attempt')})")
    work = Path(tempfile.mkdtemp(prefix="rc_job_"))
    try:
        suffix = Path(str(job.get("fileName", ""))).suffix.lower() or ".bin"
        report = work / f"report{suffix}"
        try:
            _download(job["downloadUrl"], report)
            result = check_report_file(report)
            res = _post("/api/report-check/v1/complete", {"jobId": job_id, "ok": True, "result": result}, secret)
            _log(f"job {job_id}: done -> {res.get('ok')} trades={result['metrics']['tradeCount']}")
        except CheckFailed as e:
            res = _post("/api/report-check/v1/complete", {"jobId": job_id, "ok": False, "reason": e.reason}, secret)
            _log(f"job {job_id}: failed ({e.reason}) -> {res.get('ok')}")
        except Exception as e:  # noqa: BLE001 - never crash the loop on one bad file
            res = _post("/api/report-check/v1/complete", {"jobId": job_id, "ok": False, "reason": R_GENERIC}, secret)
            _log(f"job {job_id}: unexpected {type(e).__name__} -> {res.get('ok')}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return True


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == "--file":
        try:
            print(json.dumps(check_report_file(Path(sys.argv[2])), indent=2))
        except CheckFailed as e:
            print("FAILED:", e.reason)
            sys.exit(2)
        return
    secret = os.environ.get("REPORT_CHECK_WORKER_SECRET", "")
    if len(secret) < 16:
        print("REPORT_CHECK_WORKER_SECRET is missing or too short", file=sys.stderr)
        sys.exit(1)
    _log(f"report-check worker started; site={BASE_URL}; M2={M2_DIR}")
    while True:
        try:
            handled = process_one(secret)
        except Exception as e:  # noqa: BLE001 - network blips must not kill the worker
            _log(f"loop error: {type(e).__name__}: {e}")
            handled = False
        if not handled:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
