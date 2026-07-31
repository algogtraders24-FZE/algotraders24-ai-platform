// components/ui/Alert.tsx
// Sprint D1.0 - One banner/alert primitive for form errors, action results,
// and page-level error states - replaces the many hand-rolled
// "rounded-xl border border-red-400/30 bg-red-500/10 p-4" blocks scattered
// across dashboard pages, each with a marginally different shade of red.
import type { HTMLAttributes } from "react";
import type { BadgeTone } from "./Badge";

export type AlertTone = Extract<BadgeTone, "success" | "warning" | "danger" | "info">;

const TONE_CLASSES: Record<AlertTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

export default function Alert({ tone = "info", title, className = "", children, ...rest }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={["rounded-card border p-4 text-sm", TONE_CLASSES[tone], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-1 text-text-2" : "text-text-2"}>{children}</div>
    </div>
  );
}
