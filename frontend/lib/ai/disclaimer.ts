// lib/ai/disclaimer.ts
// Sprint D2.3.S4 - the one canonical disclaimer sentence. Shown wherever an
// AI-generated market analysis, article, or evidence-backed reply is
// presented (components/ui/Disclaimer.tsx renders this by default). Also
// the value persisted on every generated article
// (services/ai/publishing/content-generator.service.ts) - one string, one
// source, never independently duplicated.
export const AI_DISCLAIMER_TEXT =
  "This is AI-generated market intelligence, not financial advice. Trading involves risk - evaluate the evidence and make your own decision.";
