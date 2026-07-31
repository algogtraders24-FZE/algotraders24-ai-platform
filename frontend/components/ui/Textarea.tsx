// components/ui/Textarea.tsx
// Sprint D1.0 - Same visual contract as Input, for multi-line fields.
import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ invalid = false, className = "", ...rest }, ref) => {
  return (
    <textarea
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
Textarea.displayName = "Textarea";

export default Textarea;
