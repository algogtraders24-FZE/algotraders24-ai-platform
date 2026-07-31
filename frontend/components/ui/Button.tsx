// components/ui/Button.tsx
// Sprint D1.0 - Unified Enterprise Design System, Phase 3. One Button for
// every CTA on the platform - previously every module invented its own
// (bg-indigo-600, bg-emerald-600, bg-sky-500, bg-gold, each with slightly
// different padding/radius/hover). Variants map onto the approved token
// system only (gold is the one primary brand accent, per the homepage);
// there is no path to a raw hex color from here.
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import Spinner from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-gold text-ink hover:brightness-110 active:brightness-95",
  secondary: "border border-border bg-transparent text-text hover:border-gold/60 hover:text-gold-strong active:bg-ink-3",
  ghost: "bg-transparent text-text-2 hover:bg-ink-3 hover:text-text active:bg-ink-4",
  danger: "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20 active:bg-danger/25",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

// Exported so a non-<button> element that needs to LOOK like a button (see
// ButtonLink below, for navigation CTAs) can share the exact same classes
// instead of hand-copying them and drifting out of sync later.
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  fullWidth = false,
  className = "",
): string {
  return [
    "inline-flex items-center justify-center rounded-control font-semibold transition",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, fullWidth = false, disabled, className = "", children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={rest.type ?? "button"}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={buttonClasses(variant, size, fullWidth, className)}
        {...rest}
      >
        {loading && <Spinner size={size === "lg" ? "md" : "sm"} />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export default Button;
