/**
 * Q0.9 - single source of truth for filesystem paths this backend touches.
 * Next.js API routes run with cwd = frontend/ (confirmed: package.json's
 * "dev"/"build" scripts run `next` from inside frontend/), so the repo
 * root is one level up. Every other backend module imports these instead
 * of building its own relative path, so there is exactly one place that
 * would need to change if the process's cwd assumption ever changes.
 */
import os from "node:os";
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

// Q1.12 hotfix - found live, in real production, the moment remote
// execution actually went live: `quant-engine/` (siblings to frontend/)
// is genuinely not part of Vercel's deployed serverless bundle (exactly
// the Q1.8 architecture finding this whole VPS-execution track exists to
// work around) - so `QUANT_ENGINE_DIR/output/jobs` doesn't exist there at
// all, and even `{recursive:true}` mkdir fails because the *root*
// `quant-engine/` directory itself isn't present to create a child under.
// jobStore.ts's own scratch/record files never needed to live next to the
// engine in the first place - that colocation was only ever convenient
// for local dev, not load-bearing. When remote execution is configured
// (QUANT_LITE_EXEC_SERVICE_URL set - the same condition under which
// Vercel no longer touches quant-engine/market.db at all, per Q1.11's own
// design), route these files to the OS temp directory instead, which is
// always writable on Vercel's Node runtime (Q0.9_JOB_LIFECYCLE.md's own
// "Known Limitations" already flagged the single-instance/non-shared
// nature of this file-based store as a real Q1 follow-up for a
// multi-instance deployment - this fix does not solve that, only the
// harder, blocking crash; the store remaining ephemeral/per-instance on
// serverless is a residual, documented risk, not something this fix
// claims to close).
export const JOBS_DIR = process.env.QUANT_LITE_EXEC_SERVICE_URL
  ? path.join(os.tmpdir(), "quant-lite-jobs")
  : path.join(QUANT_ENGINE_DIR, "output", "jobs");
