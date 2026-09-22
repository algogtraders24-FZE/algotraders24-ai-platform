"use client";

// components/shell/GlobalSearch.tsx
// Sprint UI-01 - the Topbar search slot. Deliberately scoped: there is no
// cross-entity search backend yet, so rather than fake results this is a
// real, useful navigator over the locked DASHBOARD_NAV_GROUPS - type to
// filter every destination in the app and jump to it (Cmd/Ctrl+K to open,
// arrow keys + Enter to pick). When a real search service exists it plugs
// in behind the same trigger + panel; callers never change.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DASHBOARD_NAV_GROUPS } from "@/config/dashboard.config";
import Modal from "@/components/ui/Modal";

interface Destination {
  label: string;
  href: string;
  group: string;
}

const DESTINATIONS: Destination[] = DASHBOARD_NAV_GROUPS.flatMap((group) =>
  group.items.flatMap((item) => [
    { label: item.label, href: item.href, group: group.label ?? "" },
    ...(item.children ?? []).map((child) => ({ label: child.label, href: child.href, group: item.label })),
  ]),
);

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DESTINATIONS;
    return DESTINATIONS.filter((d) => d.label.toLowerCase().includes(q) || d.group.toLowerCase().includes(q));
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      go(results[activeIndex].href);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="hidden items-center gap-2 rounded-control border border-border bg-ink-2 px-3 py-1.5 text-sm text-text-3 transition hover:border-gold/40 hover:text-text-2 md:flex md:w-64"
      >
        <Search size={15} aria-hidden="true" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-text-3">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex h-9 w-9 items-center justify-center rounded-control border border-border text-text-2 transition hover:border-gold/40 md:hidden"
      >
        <Search size={16} aria-hidden="true" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Search">
        <div className="flex items-center gap-2 rounded-control border border-border bg-ink-3 px-3">
          <Search size={16} className="text-text-3" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Jump to a page…"
            className="w-full bg-transparent py-2.5 text-sm text-text outline-none placeholder:text-text-3"
          />
        </div>

        <div className="mt-3 max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-text-3">No pages match “{query}”.</p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((d, i) => (
                <li key={d.href}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => go(d.href)}
                    className={[
                      "flex w-full items-center justify-between rounded-control px-3 py-2 text-left text-sm transition",
                      i === activeIndex ? "bg-gold/10 text-gold" : "text-text-2 hover:bg-ink-3",
                    ].join(" ")}
                  >
                    <span>{d.label}</span>
                    {d.group && <span className="text-xs text-text-3">{d.group}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
