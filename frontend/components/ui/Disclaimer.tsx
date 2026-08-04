// components/ui/Disclaimer.tsx
// Sprint D2.3.S4 - one reusable disclaimer primitive, following the same
// "replace inline one-offs with one component" precedent as Badge.tsx.
// Renders AI_DISCLAIMER_TEXT (lib/ai/disclaimer.ts) by default - no
// `text` override for new call sites, so every disclaimer on the platform
// is guaranteed to trace back to the same single source. The one narrow
// exception is a persisted historical value (e.g. an already-generated
// article's own stored `disclaimer` field, which already equals the
// canonical text) - callers with a real reason to pass one still can.
import { AI_DISCLAIMER_TEXT } from "@/lib/ai/disclaimer";

export interface DisclaimerProps {
  /** Only for historical/persisted values that already equal the canonical text (e.g. a stored article field). Defaults to AI_DISCLAIMER_TEXT. */
  text?: string;
  className?: string;
}

export default function Disclaimer({ text = AI_DISCLAIMER_TEXT, className = "" }: DisclaimerProps) {
  return (
    <p className={["border-t border-border pt-3 text-xs text-text-3", className].filter(Boolean).join(" ")}>
      {text}
    </p>
  );
}
