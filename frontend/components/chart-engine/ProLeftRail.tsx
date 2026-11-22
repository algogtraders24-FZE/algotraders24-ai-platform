"use client";
// components/chart-engine/ProLeftRail.tsx
// The Pro Chart's left tool rail (icon buttons, flyout groups that open to the right with a group title), laid out like the
// reference chart: cursor, LINES, FIBONACCI, rectangle, zoom in / out, delete, clear all, object list.
// Tools that do not exist yet are not shown (they arrive with the drawing-engine stages).
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DrawingObject, DrawingToolId } from "@/lib/chart-engine/drawing/types";
import { DRAWING_TOOL_LABEL } from "@/lib/chart-engine/drawing/types";

interface Props {
  activeTool: DrawingToolId | null;
  onSelectTool: (tool: DrawingToolId | null) => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  objectCount: number;
  onClearAll: () => void;
  drawingObjects: readonly DrawingObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onZoom: (direction: "in" | "out") => void;
}

const SVG = (p: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.children}</svg>
);
const ICONS = {
  cursor: <SVG><path d="M5 3l14 7-6 2-2 6z" /></SVG>,
  line: <SVG><path d="M5 19L19 5" /><circle cx="5" cy="19" r="1.6" /><circle cx="19" cy="5" r="1.6" /></SVG>,
  horizontal: <SVG><path d="M3 12h18" /><circle cx="12" cy="12" r="1.6" /></SVG>,
  fib: <SVG><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></SVG>,
  rect: <SVG><rect x="5" y="6" width="14" height="12" rx="1" /></SVG>,
  zoomIn: <SVG><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2M11 8v6M8 11h6" /></SVG>,
  zoomOut: <SVG><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2M8 11h6" /></SVG>,
  del: <SVG><path d="M6 6l12 12M18 6L6 18" /></SVG>,
  trash: <SVG><path d="M5 7h14M10 11v6M14 11v6M7 7l1 12h8l1-12M9 7V4h6v3" /></SVG>,
  list: <SVG><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></SVG>,
};

const BTN = "flex h-9 w-9 items-center justify-center rounded-md text-[#9aa0ae] transition hover:bg-white/[0.07] hover:text-white";
const ACTIVE = "bg-white/[0.12] text-white";

interface FlyItem { id: DrawingToolId; label: string; icon: ReactNode }
interface Group { key: string; title: string; icon: ReactNode; items: FlyItem[] }

const GROUPS: Group[] = [
  { key: "lines", title: "Lines", icon: ICONS.line, items: [
    { id: "trendline", label: "Trendline", icon: ICONS.line },
    { id: "horizontal-line", label: "Horizontal Line", icon: ICONS.horizontal },
  ] },
  { key: "fib", title: "Fibonacci", icon: ICONS.fib, items: [{ id: "fibonacci", label: "Retracement", icon: ICONS.fib }] },
];

export default function ProLeftRail(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [list, setList] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open && !list) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(null); setList(false); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setList(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, list]);

  const groupActive = (g: Group) => g.items.some((i) => i.id === p.activeTool);
  const lastPicked = useRef<Record<string, FlyItem>>({});
  const shownIcon = (g: Group) => (g.items.find((i) => i.id === p.activeTool) ?? lastPicked.current[g.key] ?? g.items[0]).icon;

  return (
    <div ref={ref} role="toolbar" aria-label="Chart drawing tools" className="relative flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0d0e12] py-2">
      <button type="button" title="Cursor (Esc)" aria-label="Cursor" aria-pressed={p.activeTool === null} onClick={() => p.onSelectTool(null)} className={`${BTN} ${p.activeTool === null ? ACTIVE : ""}`}>{ICONS.cursor}</button>
      {GROUPS.map((g) => (
        <div key={g.key} className="relative">
          <button
            type="button"
            title={g.title}
            aria-label={g.title}
            aria-expanded={open === g.key}
            aria-haspopup="menu"
            onClick={() => setOpen(open === g.key ? null : g.key)}
            className={`${BTN} ${groupActive(g) ? ACTIVE : ""}`}
          >
            {shownIcon(g)}
            <span className="absolute bottom-1 right-1 h-0 w-0 border-b-[4px] border-l-[4px] border-b-[#9aa0ae] border-l-transparent" aria-hidden="true" />
          </button>
          {open === g.key && (
            <div role="menu" className="absolute left-full top-0 z-40 ml-1 w-56 rounded-lg border border-white/10 bg-[#13141a] p-1.5 shadow-2xl">
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#6b7280]">{g.title}</p>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { lastPicked.current[g.key] = it; p.onSelectTool(p.activeTool === it.id ? null : it.id); setOpen(null); }}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] text-[#d1d4dc] hover:bg-white/[0.07] ${p.activeTool === it.id ? "bg-white/[0.1]" : ""}`}
                >
                  <span className="text-[#9aa0ae]">{it.icon}</span>
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" title="Rectangle" aria-label="Rectangle" aria-pressed={p.activeTool === "rectangle"} onClick={() => p.onSelectTool(p.activeTool === "rectangle" ? null : "rectangle")} className={`${BTN} ${p.activeTool === "rectangle" ? ACTIVE : ""}`}>{ICONS.rect}</button>

      <span className="my-1 h-px w-6 bg-white/[0.08]" aria-hidden="true" />
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => p.onZoom("in")} className={BTN}>{ICONS.zoomIn}</button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => p.onZoom("out")} className={BTN}>{ICONS.zoomOut}</button>

      <div className="flex-1" />
      <div className="relative">
        <button type="button" title="Object list" aria-label="Object list" aria-expanded={list} onClick={() => setList((v) => !v)} className={`${BTN} ${list ? ACTIVE : ""}`}>
          {ICONS.list}
          {p.objectCount > 0 && <span className="absolute right-0.5 top-0.5 rounded-full bg-violet-500 px-1 text-[9px] font-semibold leading-3 text-white">{p.objectCount}</span>}
        </button>
        {list && (
          <div role="menu" aria-label="Object list" className="absolute bottom-0 left-full z-40 ml-1 w-60 rounded-lg border border-white/10 bg-[#13141a] p-1.5 shadow-2xl">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[#6b7280]">Objects</p>
            {p.drawingObjects.length === 0 && <p className="px-2 py-2 text-xs text-[#6b7280]">No objects drawn yet</p>}
            {[...p.drawingObjects].sort((a, b) => a.createdAt - b.createdAt).map((o, i) => (
              <div key={o.id} className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${o.id === p.selectedObjectId ? "bg-white/[0.1]" : "hover:bg-white/[0.06]"}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden="true" />
                <button type="button" onClick={() => p.onSelectObject(o.id)} className="flex-1 truncate text-left text-xs text-[#d1d4dc]">#{i + 1} {DRAWING_TOOL_LABEL[o.tool]}</button>
                <button type="button" aria-label={`Delete object #${i + 1}`} onClick={() => p.onDeleteObject(o.id)} className="text-xs text-[#6b7280] opacity-0 hover:text-red-400 group-hover:opacity-100">×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" title="Delete selected (Del)" aria-label="Delete selected" disabled={!p.hasSelection} onClick={p.onDeleteSelected} className={`${BTN} disabled:cursor-not-allowed disabled:opacity-30`}>{ICONS.del}</button>
      <button type="button" title="Remove all drawings" aria-label="Remove all drawings" disabled={p.objectCount === 0} onClick={p.onClearAll} className={`${BTN} text-red-400/80 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30`}>{ICONS.trash}</button>
    </div>
  );
}
