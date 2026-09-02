/**
 * Q1.4 Part 17/18 - the controlled process boundary for code generation.
 * Same security posture as executionAdapter.ts (Q0.9): child_process.spawn
 * with shell:false and array args only, server-generated temp file paths
 * only, never a client-supplied path or shell string. Unlike a backtest,
 * generation is fast and synchronous from the caller's point of view - no
 * job queue, no polling; the API route awaits this directly.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CODEGEN_RUNNER_SCRIPT, JOBS_DIR } from "./repoPaths";
import type { StrategySpec } from "@/types/quant-lite";
import type { CodegenError, CodegenErrorCode, CodegenResponse, TargetLanguage } from "@/types/quant-lite-codegen";

const CODEGEN_TIMEOUT_MS = Number(process.env.QUANT_LITE_CODEGEN_TIMEOUT_MS) || 20_000;
const PYTHON_EXECUTABLE = process.env.QUANT_ENGINE_PYTHON || "python";

export class CodegenAdapterError extends Error {
  code: CodegenErrorCode;
  details?: string[];
  constructor(code: CodegenErrorCode, message: string, details?: string[]) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function runCodegen(strategy: StrategySpec, targetLanguage: TargetLanguage): Promise<CodegenResponse> {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  const runId = randomUUID();
  const configPath = path.join(JOBS_DIR, `${runId}.codegen-config.json`);
  const outPath = path.join(JOBS_DIR, `${runId}.codegen-out.json`);

  fs.writeFileSync(configPath, JSON.stringify({ spec: strategy, targetLanguage }, null, 2), "utf-8");

  try {
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      const child = spawn(PYTHON_EXECUTABLE, [CODEGEN_RUNNER_SCRIPT, "--config", configPath, "--out", outPath], {
        shell: false,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already exited
          }
        }, 2000);
      }, CODEGEN_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new CodegenAdapterError("ENGINE_ERROR", `failed to start generator process: ${err.message}`));
      });

      child.on("close", () => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new CodegenAdapterError("TIMEOUT", `code generation exceeded the ${CODEGEN_TIMEOUT_MS}ms timeout`));
          return;
        }
        resolve();
      });
    });

    const raw = JSON.parse(fs.readFileSync(outPath, "utf-8")) as
      | { status: "COMPLETED"; code: string; provenance: CodegenResponse["provenance"] }
      | { status: "FAILED"; errorCode: CodegenErrorCode; errorMessage: string; details?: string[] };

    if (raw.status === "FAILED") {
      throw new CodegenAdapterError(raw.errorCode, raw.errorMessage, raw.details);
    }
    return { code: raw.code, provenance: raw.provenance };
  } finally {
    try {
      fs.rmSync(configPath, { force: true });
      fs.rmSync(outPath, { force: true });
    } catch {
      // non-fatal - temp file cleanup only
    }
  }
}

export type { CodegenError };
