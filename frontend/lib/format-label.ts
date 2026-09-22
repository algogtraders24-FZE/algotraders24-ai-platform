// lib/format-label.ts
// Beta content pass - several Algo Testing Pro pages render a Badge whose
// child is a raw UPPERCASE status/verdict/outcome enum value verbatim
// (e.g. "QUEUED", "INCONCLUSIVE") - Badge's own `capitalize` CSS only
// capitalizes a word's first letter, it never lowercases the rest, so an
// all-caps source string renders unchanged. Every value in this family of
// enums (OptimizationCandidateStatus, WalkForwardFoldStatus,
// WalkForwardVerdict, etc. - see types/optimization.ts, types/walk-
// forward.ts) is a single word with no underscore, so one generic
// Title Case helper covers all of them - no per-enum label map needed.
export function titleCaseLabel(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0) + value.slice(1).toLowerCase();
}
