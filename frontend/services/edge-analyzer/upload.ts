// services/edge-analyzer/upload.ts
// AT24 Trader Edge Analyzer (E3) - the transport-independent upload handler.
// The route is a thin adapter over processUpload(); all validation lives here so
// it is testable without a server or a session.
//
// Why gzip: Vercel rejects request bodies over ~4.5 MB, and MT5 writes reports in
// UTF-16 (a real 892-trade report is 4.8 MB). The browser gzips the file before
// upload (HTML compresses ~10x) and the server decompresses it here with a hard
// OUTPUT cap, so a "zip bomb" cannot exhaust memory.
//
// Privacy: nothing here persists or logs file content; the analysis is returned
// to the caller and discarded.

import { gunzipSync } from "node:zlib";
import { analyzeMt5ReportBuffer, type EdgeReportE1 } from "./index";

/** Largest body the platform accepts on the wire (compressed or raw). */
export const MAX_WIRE_BYTES = 4_400_000;
/** Largest decoded report we will analyze. */
export const MAX_DECODED_BYTES = 12 * 1024 * 1024;

export type UploadErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "BAD_ENCODING"
  | "UNSUPPORTED_REPORT"
  | "ANALYSIS_FAILED";

export type UploadOutcome =
  | { ok: true; status: 200; report: EdgeReportE1 }
  | { ok: false; status: 400 | 422; code: UploadErrorCode; message: string };

const fail = (status: 400 | 422, code: UploadErrorCode, message: string): UploadOutcome => ({ ok: false, status, code, message });

export function processUpload(input: { fileName: string; bytes: Uint8Array; gzip: boolean }): UploadOutcome {
  const name = (input.fileName ?? "").trim().toLowerCase();
  if (!/\.(html?|htm)$/.test(name)) {
    return fail(400, "UNSUPPORTED_FILE_TYPE", "Please upload the MetaTrader 5 report saved as HTML (.html).");
  }
  if (input.bytes.length === 0) return fail(400, "EMPTY_FILE", "The file is empty.");
  if (input.bytes.length > MAX_WIRE_BYTES) return fail(400, "FILE_TOO_LARGE", "The file is too large to upload.");

  let decoded: Uint8Array = input.bytes;
  if (input.gzip) {
    try {
      decoded = gunzipSync(input.bytes, { maxOutputLength: MAX_DECODED_BYTES });
    } catch (err) {
      const tooBig = err instanceof RangeError || (err instanceof Error && /larger than|maxOutputLength|Cannot create a Buffer/i.test(err.message));
      return tooBig
        ? fail(400, "FILE_TOO_LARGE", "The report is too large to analyze.")
        : fail(400, "BAD_ENCODING", "The uploaded data could not be read. Please try again.");
    }
  }
  if (decoded.length === 0) return fail(400, "EMPTY_FILE", "The file is empty.");
  if (decoded.length > MAX_DECODED_BYTES) return fail(400, "FILE_TOO_LARGE", "The report is too large to analyze.");

  try {
    const result = analyzeMt5ReportBuffer(decoded);
    if (!result.ok) {
      return fail(result.error === "too_large" ? 400 : 422, result.error === "too_large" ? "FILE_TOO_LARGE" : "UNSUPPORTED_REPORT", result.message);
    }
    return { ok: true, status: 200, report: result.report };
  } catch {
    return fail(422, "ANALYSIS_FAILED", "The report could not be analyzed.");
  }
}
