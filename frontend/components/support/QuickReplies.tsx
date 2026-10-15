"use client";
// components/support/QuickReplies.tsx
// AT24 Copilot Phase 4: starter chips shown before the first question (the Didit pattern). Each chip
// simply asks that question through the normal flow.
export const COPILOT_QUICK_REPLIES: { label: string; question: string }[] = [
  { label: "Plans and credits", question: "What does each plan include, and how do AI credits work?" },
  { label: "What is Live Sync?", question: "What is Live Sync?" },
  { label: "Using my license key", question: "Where do I put my license key in the Expert Advisor?" },
  { label: "Refund policy", question: "What is the refund policy?" },
  { label: "Talk to a person", question: "I would like to talk to a person on the support team." },
];

export default function QuickReplies({ onPick, disabled }: { onPick: (question: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested questions">
      {COPILOT_QUICK_REPLIES.map((c) => (
        <button
          key={c.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(c.question)}
          className="rounded-full border border-border px-3 py-1 text-xs text-text-2 transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-50"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
