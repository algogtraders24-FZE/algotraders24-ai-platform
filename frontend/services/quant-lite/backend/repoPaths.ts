/**
 * Q0.9 - single source of truth for filesystem paths this backend touches.
 * Next.js API routes run with cwd = frontend/ (confirmed: package.json's
 * "dev"/"build" scripts run `next` from inside frontend/), so the repo
 * root is one level up. Every other backend module imports these instead
 * of building its own relative path, so there is exactly one place that
 * would need to change if the process's cwd assumption ever changes.
 */
import path from "node:path";

// turbopackIgnore: process.cwd() is dynamic by nature, which makes
// Turbopack's Node File Tracer conservatively trace the whole project
// into the serverless bundle (same class of warning next.config.ts's own
// outputFileTracingIncludes comment documents) - this path is never
// resolved from arbitrary/user input, only from the fixed ".." literal,
// so the ignore is safe.
export const REPO_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..");
export const QUANT_ENGINE_DIR = path.join(REPO_ROOT, "quant-engine");
export const JOB_RUNNER_SCRIPT = path.join(QUANT_ENGINE_DIR, "scripts", "run_backtest_job.py");
export const CODEGEN_RUNNER_SCRIPT = path.join(QUANT_ENGINE_DIR, "scripts", "run_codegen_job.py");
export const JOBS_DIR = path.join(QUANT_ENGINE_DIR, "output", "jobs");
