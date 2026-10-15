// services/support/follow-up-query.ts
// AT24 Copilot Phase 3 (AT24_COPILOT_SUPPORT_RND.md W3). A short follow-up such as "and what about
// the Pro plan?" cannot be searched on its own: the knowledge search only sees the current
// sentence. This builds the text the KB search should use, deterministically and without a model
// call: for a short follow-up, the previous question is prepended. The user's own question is
// never changed or shown differently - only the retrieval query is.
//
// Questions only: never answers and never account text, so account data cannot leak into the
// retrieval query or any prompt built from it.

const MAX_FOLLOW_UP_WORDS = 9;
const MAX_PREVIOUS_CHARS = 200;

// Openers that continue a thread ("and ...", "what about ...", "how about ...", "also ...").
const FOLLOW_UP_OPENER = /^(and|also|but|so|then|what about|how about|what if|ok(ay)?|and what about|why|how come|is that|does that|do they|does it|is it|can it|can they|what's that|what is that)\b/i;
// A pronoun that only makes sense with a previous sentence.
const DEPENDENT_PRONOUN = /\b(it|this|that|these|those|they|them|its|their|the same|that one|this one)\b/i;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** True when `question` is short and leans on an earlier turn. */
export function looksLikeFollowUp(question: string): boolean {
  const q = question.trim();
  if (!q || wordCount(q) > MAX_FOLLOW_UP_WORDS) return false;
  return FOLLOW_UP_OPENER.test(q) || DEPENDENT_PRONOUN.test(q);
}

/** The text the KB search should use. Equals `question` unless it is a follow-up and there is a
 *  previous question to anchor it to. `previousQuestions` is oldest-first. */
export function buildRetrievalQuery(question: string, previousQuestions: string[]): string {
  const q = question.trim();
  const prev = previousQuestions.map((p) => p.trim()).filter(Boolean);
  const last = prev[prev.length - 1];
  if (!last || !looksLikeFollowUp(q)) return q;
  const anchor = last.length > MAX_PREVIOUS_CHARS ? last.slice(0, MAX_PREVIOUS_CHARS) : last;
  return `${anchor} ${q}`;
}
