"""
Q1.4 Part 17 - the controlled process boundary for code generation,
mirroring run_backtest_job.py's exact pattern: read a validated config
JSON, call the real generator (never duplicated/reimplemented here),
write one structured result JSON. Never touches stdin, never execs a
shell string, never accepts a raw file path from outside --config/--out.

Usage:
    python run_codegen_job.py --config <path> --out <path>

Exit code 0 => --out contains {"status": "COMPLETED", "code": "...", "provenance": {...}}
Exit code 1 => --out contains {"status": "FAILED", "errorCode": ..., "errorMessage": ...}
"""
import argparse
import hashlib
import json
import os
import sys
import traceback
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUANT_ENGINE_DIR = os.path.join(SCRIPT_DIR, "..")
sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, QUANT_ENGINE_DIR)

# Bumped by hand whenever codegen_mql4.py/codegen_mql5.py/codegen_pine.py
# change in a way that affects generated output - Q1.4.16's determinism/
# provenance requirement (same spirit as the Q1.1 gap-registry version).
GENERATOR_VERSION = "q1.4-codegen-v1"

VALID_LANGUAGES = {"mql4", "mql5", "pine"}


def fail(out_path, code, message, details=None):
    payload = {
        "status": "FAILED",
        "errorCode": code,
        "errorMessage": message,
        "details": details or [],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    sys.exit(1)


def canonical_spec_hash(spec: dict) -> str:
    canonical = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out_path = args.out

    try:
        with open(args.config, "r") as f:
            config = json.load(f)
    except Exception as e:
        fail(out_path, "ENGINE_ERROR", f"could not read config file: {e}")
        return

    try:
        spec = config["spec"]
        target_language = config["targetLanguage"]
    except KeyError as e:
        fail(out_path, "INVALID_REQUEST", f"missing required config field: {e}")
        return

    if target_language not in VALID_LANGUAGES:
        fail(out_path, "INVALID_REQUEST", f"unsupported target language '{target_language}' - supported: {sorted(VALID_LANGUAGES)}")
        return

    try:
        from spec_engine.schema import validate_spec
        errors = validate_spec(spec)
        if errors:
            fail(out_path, "INVALID_STRATEGY", "strategy specification failed validation - no code was generated", errors)
            return

        if target_language == "mql4":
            from spec_engine.codegen_mql4 import generate_mql4
            code = generate_mql4(spec)
        elif target_language == "mql5":
            from spec_engine.codegen_mql5 import generate_mql5
            code = generate_mql5(spec)
        else:
            from spec_engine.codegen_pine import generate_pine
            code = generate_pine(spec)

        spec_hash = canonical_spec_hash(spec)
        result_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()

        payload = {
            "status": "COMPLETED",
            "code": code,
            "provenance": {
                "strategySpecHash": spec_hash,
                "resultHash": result_hash,
                "generatorVersion": GENERATOR_VERSION,
                "targetLanguage": target_language,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            },
        }
        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2, default=str)
        sys.exit(0)

    except Exception as e:
        # Q1.5 Part 13 fix - same issue and same fix as run_backtest_job.py:
        # the full traceback (real absolute source paths in every frame)
        # was being placed into `details`, which app/api/quant-lite/codegen/
        # route.ts forwards verbatim into the client-facing error response
        # (`details: { errors: e.details ?? [] }`). Traceback still fully
        # captured, just routed to stderr only - never returned by the API.
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__))[-4000:]
        print(tb, file=sys.stderr)
        fail(out_path, "ENGINE_ERROR", str(e), ["an internal engine error occurred - details were logged server-side, not exposed to the client"])


if __name__ == "__main__":
    main()
