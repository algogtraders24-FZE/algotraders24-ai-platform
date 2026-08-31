/**
 * Q1.4 Part 17 - the code-generation contract. Synchronous (unlike the
 * backtest job queue) - generation is a pure, fast, deterministic
 * transform over an already-validated spec, not a long-running engine
 * run, so no QUEUED/RUNNING lifecycle is needed.
 */
import type { StrategySpec } from "@/types/quant-lite";

export const SUPPORTED_CODEGEN_LANGUAGES = ["mql4", "mql5", "pine"] as const;
export type TargetLanguage = (typeof SUPPORTED_CODEGEN_LANGUAGES)[number];

export interface CodegenRequest {
  strategy: StrategySpec;
  targetLanguage: TargetLanguage;
}

export interface CodegenProvenance {
  strategySpecHash: string;
  resultHash: string;
  generatorVersion: string;
  targetLanguage: TargetLanguage;
  generatedAt: string;
}

export interface CodegenResponse {
  code: string;
  provenance: CodegenProvenance;
}

export type CodegenErrorCode = "INVALID_REQUEST" | "INVALID_STRATEGY" | "UNSUPPORTED_LANGUAGE" | "ENGINE_ERROR" | "TIMEOUT";

export interface CodegenError {
  code: CodegenErrorCode;
  message: string;
  details?: string[];
}
