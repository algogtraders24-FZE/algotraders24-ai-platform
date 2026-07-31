// components/ui/Badge.tsx
// Sprint D1.0 - One status-pill primitive. Replaces the many inline
// "rounded-full px-2.5 py-1 text-xs font-semibold" one-offs (invoice
// status, role, plan, feedback status, subscription status), each with a
// slightly different color mapping for the same neutral/success/danger
// meaning.
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "gold";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-border bg-ink-3 text-text-2",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
  gold: "border-gold/30 bg-gold/10 text-gold",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export default function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={["inline-flex items-center rounded-control border px-2.5 py-0.5 text-xs font-semibold capitalize", TONE_CLASSES[tone], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}
