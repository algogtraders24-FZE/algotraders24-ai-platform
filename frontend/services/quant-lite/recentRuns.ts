// services/quant-lite/recentRuns.ts
// Sprint IA2 - honest groundwork for the backoffice WORKSPACE/Results slot.
// Quant Lite backtest jobs have no userId at all (services/quant-lite/
// backend/jobStore.ts writes one JSON file per job, keyed only by a random
// jobId - see docs/IA1-BACKOFFICE-NAVIGATION-REFACTOR.md and Q1.6 Part 11),
// so a real per-account "my results" history is a genuine backend feature,
// not something a navigation/UX sprint can build. This is the honest
// version of that idea that's actually buildable today: a per-BROWSER
// recent-runs list, keyed by the same jobId the app already redirects to
// after a run. Mirrors QuantLiteBacktestService's saveDraftSpec/
// loadDraftSpec pattern (sync, window guard, try/catch, best-effort only -
// never a source of truth), but on localStorage (not sessionStorage) since
// unlike the draft spec bridge, this is meant to survive across sessions.
const RECENT_RUNS_KEY = "quant-lite-recent-runs";
const MAX_RECENT_RUNS = 20;

export interface RecentRun {
  jobId: string;
  name: string;
  symbol: string;
  timeframe: string;
  submittedAt: string;
}

export function recordRecentRun(run: RecentRun): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadRecentRuns().filter((r) => r.jobId !== run.jobId);
    const next = [run, ...existing].slice(0, MAX_RECENT_RUNS);
    window.localStorage.setItem(RECENT_RUNS_KEY, JSON.stringify(next));
  } catch {
    // best-effort only - a per-device convenience list, never real
    // persistence (see the module comment above).
  }
}

export function loadRecentRuns(): RecentRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentRun[]) : [];
  } catch {
    return [];
  }
}
