/**
 * Q0.9 - real backtest job contracts. These sit alongside the frozen Q0.7/
 * Q0.8 types in types/quant-lite.ts (BacktestRequest/BacktestResult are
 * unchanged - a job just wraps a BacktestRequest with async lifecycle
 * state and ultimately produces exactly one BacktestResult).
 */
import type { BacktestRequest, BacktestResult, StrategySpec } from "@/types/quant-lite";
import type { CoverageAssessment } from "@/types/quant-lite-coverage";

export type BacktestJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

/**
 * Q0.9 Part 24's required failure taxonomy. Distinct from
 * QuantLiteErrorCode (types/quant-lite.ts) which is UI/client-validation
 * oriented (Q0.7) - this is the job/execution-layer taxonomy. A FAILED
 * job's error is translated into a QuantLiteError on the BacktestResult
 * shown in the UI (see backend/resultMapper.ts) so existing components
 * don't need two parallel error-rendering paths.
 */
export type BacktestJobErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_STRATEGY"
  | "DATA_UNAVAILABLE"
  | "BACKTEST_FAILED"
  | "BACKTEST_TIMEOUT"
  | "ENGINE_ERROR"
  | "RESULT_INVALID"
  | "UNKNOWN_ERROR";

export interface BacktestJobError {
  code: BacktestJobErrorCode;
  message: string;
  details?: string[];
}

/**
 * The full on-disk job record (frontend/services/quant-lite/backend/jobStore.ts).
 * Never trust `request` from a client on a GET - it is read back only for
 * display/reproducibility, all authority lives in what was validated at
 * creation time.
 */
export interface BacktestJobRecord {
  jobId: string;
  requestHash: string;
  status: BacktestJobStatus;
  request: BacktestRequest;
  dbSymbol: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: BacktestResult;
  error?: BacktestJobError;
  engineExitCode?: number | null;
  stderrTail?: string;
  /**
   * Q1.1.21 - computed once at job creation (server-authoritative, never
   * client-supplied) and carried through to the final result's
   * provenance unchanged. Optional, not because a Q1.1+ job can lack it
   * (route.ts always sets it), but because job records on disk from
   * before Q1.1 (Q0.9/Q1.0) genuinely predate this field - honest about
   * real stored data rather than a type that lies about legacy records.
   */
  dataQuality?: CoverageAssessment;
}

/** POST /api/quant-lite/backtest response body (in ApiResponse.data). */
export interface CreateBacktestJobResponse {
  jobId: string;
  status: BacktestJobStatus;
  requestHash: string;
  /** true if this returned an existing job for an identical request rather than starting a new one (Q0.9.26 idempotency). */
  reused: boolean;
}

/** GET /api/quant-lite/backtest/[jobId] response body (in ApiResponse.data). */
export interface GetBacktestJobResponse {
  jobId: string;
  status: BacktestJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: BacktestResult;
  error?: BacktestJobError;
  /** Absent only for jobs created before Q1.1 - see BacktestJobRecord.dataQuality. */
  dataQuality?: CoverageAssessment;
  /** Q1.4 Part 19 - the original spec, for "Generate Code" on a completed result. Read-only display data, not authoritative for anything. */
  strategy?: StrategySpec;
}
