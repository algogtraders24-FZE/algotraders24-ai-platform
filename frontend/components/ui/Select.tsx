// components/ui/Select.tsx
// Sprint D1.0 - Same visual contract as Input, for native <select> filters
// (admin list filters, etc.) - deliberately native (not a custom listbox)
// for full keyboard/screen-reader behavior for free.
import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";

const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className = "", children, ...rest }, ref) => {
  return (
    <select
      ref={ref}
      className={[
        "rounded-control border border-border bg-ink-2 px-3 py-2 text-sm text-text",
        "outline-none transition focus:border-gold",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";

export default Select;
