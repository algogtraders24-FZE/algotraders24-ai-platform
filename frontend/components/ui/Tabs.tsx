"use client";
// components/ui/Tabs.tsx
// Sprint D1.0 - One tab-strip primitive. Controlled (value/onChange) rather
// than owning its own state, so it works equally for an in-page tab switch
// or as the visual layer under a set of route links (see AdminNavTabs).
// Full keyboard support: arrow keys move focus and selection, matching the
// WAI-ARIA tabs pattern.
import { useRef } from "react";

export interface TabItem {
  value: string;
  label: string;
}

export default function Tabs({
  items,
  value,
  onChange,
  className = "",
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    const nextItem = items[next];
    onChange(nextItem.value);
    refs.current[nextItem.value]?.focus();
  };

  return (
    <div role="tablist" className={["flex flex-wrap gap-1 border-b border-border", className].filter(Boolean).join(" ")}>
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[item.value] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={[
              "rounded-t-control border-b-2 px-3 py-2 text-sm font-medium transition",
              active ? "border-gold text-gold" : "border-transparent text-text-3 hover:text-text",
            ].join(" ")}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
