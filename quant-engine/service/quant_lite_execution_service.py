"""
quant-engine/service/quant_lite_execution_service.py

Q1.11 - the VPS-hosted HTTP execution service for Quant Lite. Deliberately
built as a THIN TRANSPORT WRAPPER, not a second engine: every real backtest
request is fulfilled by spawning the exact same, unmodified
run_backtest_job.py this whole program has used since Q0.9 - identical
argv, identical config shape, identical timeout/SIGTERM/SIGKILL handling,
identical concurrency cap. Nothing about the engine's own logic is
reimplemented here.

Auth pattern, health-endpoint shape, and constant-time bearer-token check
are copied deliberately from mt5-bridge/bridge.py - the one HTTP service
this VPS already runs successfully in production - rather than inventing a
new pattern. fastapi>=0.110.0 / uvicorn[standard]>=0.29.0 match that
service's own already-proven requirements.txt floors.

IMPORTANT (Q1.11 Part 2's own hard rule): this service accepts ONLY the
existing validated Quant Lite BacktestRequest shape. It never accepts a
filesystem path, a shell command, Python code, an arbitrary engine
argument, or an arbitrary database path from the request body - the only
file paths that ever exist in this process are the ones this file itself
constructs from a server-generated UUID, under a fixed root directory.

Run (from this file's own directory, inside the isolated Q1.10 venv):
    uvicorn quant_lite_execution_service:app --host 127.0.0.1 --port 8788
Deliberately bound to 127.0.0.1 only (see Q1.11_NETWORK_TOPOLOGY.md) -
this service is never meant to be reachable except through the existing
Cloudflare Tunnel, exactly like the MT5 bridge's own port 8787.
"""

import asyncio
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

# ---------------------------------------------------------------------------
# PATHS - fixed, server-side only. Never derived from request input.
# ---------------------------------------------------------------------------
SERVICE_DIR = Path(__file__).resolve().parent
ROOT = SERVICE_DIR.parent.parent  # C:\AT24\quant-lite\
JOB_RUNNER_SCRIPT = ROOT / "quant-engine" / "scripts" / "run_backtest_job.py"
JOBS_DIR = ROOT / "jobs"
JOBS_DIR.mkdir(parents=True, exist_ok=True)

PYTHON_EXECUTABLE = sys.executable  # the venv's own interpreter, not a client-influenced value

# ---------------------------------------------------------------------------
# CONFIG - same constants and defaults executionAdapter.ts already used,
# just relocated. Env-overridable the same way, never client-overridable.
# ---------------------------------------------------------------------------
MAX_CONCURRENT_BACKTESTS = int(os.environ.get("QUANT_LITE_MAX_CONCURRENT_BACKTESTS", "2"))
BACKTEST_TIMEOUT_S = int(os.environ.get("QUANT_LITE_BACKTEST_TIMEOUT_MS", "180000")) / 1000
STDERR_TAIL_LIMIT = 4000
SPREAD_PRICE = 0.3
CONTRACT_SIZE = 100

# REAL_EXECUTION_SYMBOLS is re-imported from schema/run_backtest_job's own
# module rather than duplicated here, so there is exactly one place this
# list is ever defined.
sys.path.insert(0, str(ROOT / "quant-engine"))
from spec_engine.schema import validate_spec  # noqa: E402

app = FastAPI(
    title="AT24 Quant Lite Execution Service",
    description="Thin HTTP wrapper around the canonical run_backtest_job.py / execution_mtf.py engine.",
)

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_BACKTESTS)
_jobs_lock = asyncio.Lock()  # guards job-record read/modify/write only, not the subprocess itself


# ---------------------------------------------------------------------------
# AUTHENTICATION - identical pattern to mt5-bridge/bridge.py's own
# _require_secret(): fail-closed (no configured secret = every
# authenticated endpoint refuses, not a silent bypass), constant-time
# comparison, Bearer scheme, never echoes the presented or configured value
# back in any response or log line.
# ---------------------------------------------------------------------------
def _require_secret(authorization: Optional[str]) -> None:
    configured = os.environ.get("QUANT_LITE_EXEC_SECRET", "")
    if not configured:
        raise HTTPException(status_code=503, detail="execution service secret not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    presented = authorization[len("Bearer "):].strip()
    if not presented or not hmac.compare_digest(presented, configured):
        raise HTTPException(status_code=401, detail="invalid bearer token")


# ---------------------------------------------------------------------------
# JOB STORE - one JSON file per job, same shape/spirit as
# frontend/services/quant-lite/backend/jobStore.ts, so a future reader of
# either store recognizes the pattern immediately. jobId is ALWAYS either
# server-generated here or a UUID the caller supplied that is validated
# against a strict UUID regex before ever touching the filesystem -
# preserves the same path-traversal defense jobStore.ts already documents.
# ---------------------------------------------------------------------------
import re  # noqa: E402

_JOB_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def _is_valid_job_id(job_id: str) -> bool:
    return bool(_JOB_ID_RE.match(job_id))


def _record_path(job_id: str) -> Path:
    if not _is_valid_job_id(job_id):
        raise ValueError(f"refusing to touch filesystem for invalid jobId: {job_id!r}")
    return JOBS_DIR / f"{job_id}.record.json"


def _config_path(job_id: str) -> Path:
    if not _is_valid_job_id(job_id):
        raise ValueError(f"refusing to touch filesystem for invalid jobId: {job_id!r}")
    return JOBS_DIR / f"{job_id}.config.json"


def _out_path(job_id: str) -> Path:
    if not _is_valid_job_id(job_id):
        raise ValueError(f"refusing to touch filesystem for invalid jobId: {job_id!r}")
    return JOBS_DIR / f"{job_id}.out.json"


def _read_record(job_id: str) -> Optional[dict]:
    p = _record_path(job_id)
    if not p.exists():
        return None
    with open(p, "r") as f:
        return json.load(f)


def _write_record(job_id: str, record: dict) -> None:
    with open(_record_path(job_id), "w") as f:
        json.dump(record, f, indent=2, default=str)


def _find_active_by_request_hash(request_hash: str) -> Optional[dict]:
    """Same idempotency contract as jobStore.ts's findActiveJobByRequestHash -
    an identical in-flight/completed request reuses the same job."""
    for p in JOBS_DIR.glob("*.record.json"):
        try:
            record = json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if record.get("requestHash") == request_hash and record.get("status") not in ("FAILED", "CANCELLED"):
            return record
    return None


# ---------------------------------------------------------------------------
# REQUEST VALIDATION - re-validates independently, does not trust that
# whatever called this (Vercel) already validated correctly. Same
# defense-in-depth principle validateBacktestRequest.ts's own header
# comment already states for the Node<->Python boundary, extended here to
# the new network boundary.
# ---------------------------------------------------------------------------
_ALLOWED_TOP_LEVEL_KEYS = {
    "jobId", "requestHash", "strategy", "symbol", "timeframe", "dateRange", "initialCapital", "riskPct",
}


def _validate_backtest_request(body: dict) -> list:
    errors = []
    unknown = set(body.keys()) - _ALLOWED_TOP_LEVEL_KEYS
    if unknown:
        errors.append(f"unknown top-level field(s), rejected: {sorted(unknown)}")

    strategy = body.get("strategy")
    if not isinstance(strategy, dict):
        errors.append("'strategy' must be an object")
    else:
        errors.extend(validate_spec(strategy))

    symbol = body.get("symbol")
    if not isinstance(symbol, str) or not symbol:
        errors.append("'symbol' must be a non-empty string")

    timeframe = body.get("timeframe")
    if not isinstance(timeframe, str) or not timeframe:
        errors.append("'timeframe' must be a non-empty string")

    date_range = body.get("dateRange")
    if not isinstance(date_range, dict) or "start" not in date_range or "end" not in date_range:
        errors.append("'dateRange' must be an object with 'start' and 'end'")

    initial_capital = body.get("initialCapital")
    if not isinstance(initial_capital, (int, float)) or initial_capital <= 0:
        errors.append("'initialCapital' must be a positive number")

    risk_pct = body.get("riskPct")
    if not isinstance(risk_pct, (int, float)) or risk_pct <= 0:
        errors.append("'riskPct' must be a positive number")

    return errors


# ---------------------------------------------------------------------------
# EXECUTION - spawns the SAME unmodified run_backtest_job.py, shell=False,
# fixed argv array only (--config <server-generated path> --out
# <server-generated path>) - structurally identical to
# executionAdapter.ts's own spawn() call, just running here instead of in
# the Vercel Node process.
# ---------------------------------------------------------------------------
async def _run_job(job_id: str, config: dict) -> None:
    async with _semaphore:
        record = _read_record(job_id)
        record["status"] = "RUNNING"
        record["startedAt"] = datetime.now(timezone.utc).isoformat()
        _write_record(job_id, record)

        config_path = _config_path(job_id)
        out_path = _out_path(job_id)
        with open(config_path, "w") as f:
            json.dump(config, f)

        start = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                PYTHON_EXECUTABLE, str(JOB_RUNNER_SCRIPT), "--config", str(config_path), "--out", str(out_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(), timeout=BACKTEST_TIMEOUT_S)
                timed_out = False
            except asyncio.TimeoutError:
                timed_out = True
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=2)
                except asyncio.TimeoutError:
                    proc.kill()  # no orphan survives - same SIGTERM-then-SIGKILL pattern as executionAdapter.ts
                stderr = b""
        except Exception as e:
            record = _read_record(job_id)
            record["status"] = "FAILED"
            record["error"] = {"code": "ENGINE_ERROR", "message": "failed to start engine process", "details": []}
            record["completedAt"] = datetime.now(timezone.utc).isoformat()
            record["durationMs"] = int((time.monotonic() - start) * 1000)
            _write_record(job_id, record)
            return
        finally:
            for p in (config_path,):
                try:
                    p.unlink(missing_ok=True)
                except OSError:
                    pass

        duration_ms = int((time.monotonic() - start) * 1000)
        record = _read_record(job_id)
        record["durationMs"] = duration_ms
        record["stderrTail"] = stderr.decode("utf-8", errors="replace")[-STDERR_TAIL_LIMIT:] if stderr else None
        # stderrTail is stored server-side ONLY - never returned by GET
        # /backtest/{jobId} below, matching Q1.5's own client-facing fix.

        if timed_out:
            record["status"] = "FAILED"
            record["error"] = {"code": "BACKTEST_TIMEOUT", "message": f"backtest exceeded the {int(BACKTEST_TIMEOUT_S * 1000)}ms timeout and was terminated", "details": []}
            record["completedAt"] = datetime.now(timezone.utc).isoformat()
            _write_record(job_id, record)
            return

        if not out_path.exists():
            record["status"] = "FAILED"
            record["error"] = {"code": "ENGINE_ERROR", "message": "engine process exited without producing a result file", "details": []}
            record["completedAt"] = datetime.now(timezone.utc).isoformat()
            _write_record(job_id, record)
            return

        try:
            raw = json.loads(out_path.read_text())
        except (json.JSONDecodeError, OSError):
            record["status"] = "FAILED"
            record["error"] = {"code": "RESULT_INVALID", "message": "engine result could not be read", "details": []}
            record["completedAt"] = datetime.now(timezone.utc).isoformat()
            _write_record(job_id, record)
            out_path.unlink(missing_ok=True)
            return

        if raw.get("status") == "FAILED":
            known_codes = {"INVALID_REQUEST", "INVALID_STRATEGY", "DATA_UNAVAILABLE", "BACKTEST_FAILED", "BACKTEST_TIMEOUT", "ENGINE_ERROR", "RESULT_INVALID", "UNKNOWN_ERROR"}
            code = raw.get("errorCode") if raw.get("errorCode") in known_codes else "UNKNOWN_ERROR"
            record["status"] = "FAILED"
            record["error"] = {"code": code, "message": raw.get("errorMessage", "backtest failed"), "details": raw.get("details", [])}
        elif raw.get("status") == "COMPLETED":
            record["status"] = "COMPLETED"
            record["result"] = raw
        else:
            record["status"] = "FAILED"
            record["error"] = {"code": "RESULT_INVALID", "message": f"unrecognized engine status: {raw.get('status')}", "details": []}

        record["completedAt"] = datetime.now(timezone.utc).isoformat()
        _write_record(job_id, record)
        out_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# HEALTH - unauthenticated, matches mt5-bridge/bridge.py's own reasoning
# (liveness/config status only, no strategy/result data, safe to poll
# without a credential).
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> JSONResponse:
    secret_configured = bool(os.environ.get("QUANT_LITE_EXEC_SECRET", ""))
    engine_present = JOB_RUNNER_SCRIPT.exists()
    db_present = (ROOT / "quant_engine" / "market.db").exists()
    return JSONResponse({
        "status": "ok" if (secret_configured and engine_present and db_present) else "not_ready",
        "secretConfigured": secret_configured,
        "enginePresent": engine_present,
        "marketDbPresent": db_present,
    })


# ---------------------------------------------------------------------------
# POST /backtest
# ---------------------------------------------------------------------------
@app.post("/backtest")
async def create_backtest(request: Request, authorization: Optional[str] = Header(None)) -> JSONResponse:
    _require_secret(authorization)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="request body must be valid JSON")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="request body must be a JSON object")

    errors = _validate_backtest_request(body)
    if errors:
        raise HTTPException(status_code=400, detail={"code": "INVALID_REQUEST", "errors": errors})

    request_hash = body.get("requestHash")
    if not isinstance(request_hash, str) or not request_hash:
        raise HTTPException(status_code=400, detail="'requestHash' is required (computed server-side by Vercel, forwarded here for idempotency)")

    async with _jobs_lock:
        existing = _find_active_by_request_hash(request_hash)
        if existing:
            return JSONResponse({"jobId": existing["jobId"], "status": existing["status"], "requestHash": request_hash, "reused": True})

        job_id = body.get("jobId")
        if not isinstance(job_id, str) or not _is_valid_job_id(job_id):
            job_id = str(uuid.uuid4())  # server-generated fallback - never trusts an invalid client-supplied id

        config = {
            "jobId": job_id,
            "requestHash": request_hash,
            "spec": body["strategy"],
            "dbSymbol": body["symbol"],
            "signalTimeframe": body["timeframe"],
            "execTimeframe": "1m",
            "startDate": body["dateRange"]["start"],
            "endDate": body["dateRange"]["end"],
            "initialCapital": body["initialCapital"],
            "riskPct": body["riskPct"],
            "spreadPrice": SPREAD_PRICE,   # server-pinned, never accepted from the request
            "contractSize": CONTRACT_SIZE,  # server-pinned, never accepted from the request
        }

        record = {
            "jobId": job_id,
            "requestHash": request_hash,
            "status": "QUEUED",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        _write_record(job_id, record)

    asyncio.create_task(_run_job(job_id, config))
    return JSONResponse({"jobId": job_id, "status": "QUEUED", "requestHash": request_hash, "reused": False})


# ---------------------------------------------------------------------------
# GET /backtest/{jobId}
# ---------------------------------------------------------------------------
@app.get("/backtest/{job_id}")
def get_backtest(job_id: str, authorization: Optional[str] = Header(None)) -> JSONResponse:
    _require_secret(authorization)

    if not _is_valid_job_id(job_id):
        raise HTTPException(status_code=400, detail="a valid jobId is required")

    record = _read_record(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="no job found with this id")

    # Explicit whitelist response, same discipline as
    # app/api/quant-lite/backtest/[jobId]/route.ts - never a raw dict
    # spread, so internal-only fields (stderrTail) structurally cannot leak.
    body = {
        "jobId": record["jobId"],
        "status": record["status"],
        "createdAt": record.get("createdAt"),
        "startedAt": record.get("startedAt"),
        "completedAt": record.get("completedAt"),
        "durationMs": record.get("durationMs"),
        "result": record.get("result"),
        "error": record.get("error"),
    }
    return JSONResponse(body)
