"use client";
// components/ui/Tooltip.tsx
// Sprint D1.0 - Generic hover/focus tooltip wrapping an arbitrary trigger
// element (an icon-only button, a disabled control, a truncated label).
// Distinct from InfoTooltip (components/ui/InfoTooltip.tsx), which is a
// specific "(i) click-to-reveal" affordance for product-guidance copy on
// touch devices - this one shows on hover/focus for any element and is
// meant for short, single-line hints.
import { useState } from "react";
import type { ReactNode } from "react";

export default function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-control border border-border bg-ink-2 px-2.5 py-1 text-xs text-text-2 shadow-floating"
        >
          {label}
        </span>
      )}
    </span>
  );
}
