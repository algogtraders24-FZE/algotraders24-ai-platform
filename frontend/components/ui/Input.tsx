// components/ui/Input.tsx
// Sprint D1.0 - One text input for the whole platform. Previously every
// form (auth, feedback, admin search) hand-rolled its own border/bg/focus
// classes with small drifts between them (border-neutral-700 vs
// border-slate-800 vs border-[#1F2937], for the same visual role).
import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ invalid = false, className = "", ...rest }, ref) => {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={[
        "w-full rounded-control border bg-ink-2 px-3 py-2 text-sm text-text placeholder:text-text-3",
        "outline-none transition focus:border-gold",
        invalid ? "border-danger" : "border-border",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
});
Input.displayName = "Input";

export default Input;
