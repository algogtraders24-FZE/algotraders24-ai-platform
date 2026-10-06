// services/edge-analyzer/saved.ts
// AT24 Trader Edge Analyzer - saved analyses (E4 save). OPT-IN and PAID-ONLY.
//
// What is stored: ONLY the computed analysis (EdgeReportE1: aggregates, patterns,
// evidence, risk). Never the uploaded file and never individual trades. The
// report holds no account number, name, company or server (the parser never
// reads them). Every operation is scoped to the owning user; there is no sharing.
//
// The rules (paid only, per-user cap, size cap) live here as a pure function over
// an injected store, so they are tested without a database.

import type { EdgeReportE1 } from "./index";

export const MAX_SAVED_PER_USER = 10;
/** A real 892-trade report serializes to a few tens of KB; this guards against abuse. */
export const MAX_SAVED_JSON_BYTES = 400_000;

export interface SavedAnalysisRow {
  id: string;
  createdAt: Date;
  tradeCount: number;
  level: string;
}

export interface SavedAnalysisFull extends SavedAnalysisRow {
  report: EdgeReportE1;
}

export interface EdgeSavedStore {
  count(userId: string): Promise<number>;
  create(userId: string, report: EdgeReportE1): Promise<SavedAnalysisRow>;
  list(userId: string): Promise<SavedAnalysisRow[]>;
  /** Newest when `id` is omitted. Always scoped to userId. */
  get(userId: string, id?: string): Promise<SavedAnalysisFull | null>;
  /** True only if a row owned by userId was deleted. */
  delete(userId: string, id: string): Promise<boolean>;
}

export type SaveOutcome =
  | { ok: true; saved: { id: string; createdAt: string } }
  | { ok: false; code: "PLAN_REQUIRED" | "LIMIT_REACHED" | "TOO_LARGE" | "UNAVAILABLE"; message: string };

export async function saveAnalysis(store: EdgeSavedStore, userId: string, report: EdgeReportE1, hasFullAccess: boolean): Promise<SaveOutcome> {
  if (hasFullAccess !== true) {
    return { ok: false, code: "PLAN_REQUIRED", message: "Saving analyses is part of the paid plans." };
  }
  if (JSON.stringify(report).length > MAX_SAVED_JSON_BYTES) {
    return { ok: false, code: "TOO_LARGE", message: "This analysis is too large to save." };
  }
  try {
    if ((await store.count(userId)) >= MAX_SAVED_PER_USER) {
      return { ok: false, code: "LIMIT_REACHED", message: `You can keep up to ${MAX_SAVED_PER_USER} saved analyses. Delete one to save a new one.` };
    }
    const row = await store.create(userId, report);
    return { ok: true, saved: { id: row.id, createdAt: row.createdAt.toISOString() } };
  } catch {
    // Includes "table not migrated yet": never fail the analysis itself because saving failed.
    return { ok: false, code: "UNAVAILABLE", message: "Saving is temporarily unavailable. Your analysis is still shown below." };
  }
}
