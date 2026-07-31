// components/ui/Card.tsx
// Sprint D1.0 - The one card surface. Previously: bg-[#0C1324]/border-
// [#1F2937] (dashboard), bg-white/5 backdrop-blur (billing), bg-slate-900/40
// (admin), rounded-2xl vs rounded-xl vs rounded-card - three different
// surfaces claiming to be the same kind of thing. This is all of them.
import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md" | "lg";
  raised?: boolean;
}

const PADDING_CLASSES: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export default function Card({ padding = "md", raised = false, className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={[
        "rounded-card border border-border bg-ink-2",
        raised ? "shadow-raised" : "",
        PADDING_CLASSES[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
