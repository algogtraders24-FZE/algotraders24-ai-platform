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
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  locked: boolean;
  onToggleLock: () => void;
  eraser: boolean;
  onToggleEraser: () => void;
  magnet: boolean;
  onToggleMagnet: () => void;
  style: { color: string | null; width: number };
  onStyle: (patch: { color?: string | null; width?: number }) => void;
}

const COLORS = ["#2962ff", "#26a69a", "#ef5350", "#f59e0b", "#a78bfa", "#f472b6", "#ffffff", "#9aa0ae"];
const WIDTHS = [1, 2, 3, 4];

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
  magnet: <SVG><path d="M6 4v8a6 6 0 0012 0V4M6 8h4M14 8h4" /></SVG>,
  undo: <SVG><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></SVG>,
  redo: <SVG><path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></SVG>,
  lock: <SVG><rect x="6" y="11" width="12" height="9" rx="1.5" /><path d="M9 11V8a3 3 0 016 0v3" /></SVG>,
  unlock: <SVG><rect x="6" y="11" width="12" height="9" rx="1.5" /><path d="M9 11V8a3 3 0 015.6-1.5" /></SVG>,
  eraser: <SVG><path d="M14 4l6 6-9 9H6l-3-3 11-12zM9 9l6 6M12 19h8" /></SVG>,
  ray: <SVG><circle cx="5" cy="19" r="1.6" /><path d="M5 19L21 4M16 4h5v5" /></SVG>,
  extended: <SVG><path d="M3 21L21 3M3 15v6h6M15 3h6v6" /></SVG>,
  vertical: <SVG><path d="M12 3v18" /><circle cx="12" cy="12" r="1.6" /></SVG>,
  cross: <SVG><path d="M12 3v18M3 12h18" /></SVG>,
  hray: <SVG><circle cx="5" cy="12" r="1.6" /><path d="M5 12h16M17 8l4 4-4 4" /></SVG>,
  arrow: <SVG><path d="M5 19L19 5M10 5h9v9" /></SVG>,
  measure: <SVG><path d="M3 17L17 3l4 4L7 21l-4-4zM8 12l2 2M11 9l2 2M14 6l2 2" /></SVG>,
  list: <SVG><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></SVG>,
};

const BTN = "flex h-9 w-9 items-center justify-center rounded-md text-text-3 transition hover:bg-ink-4 hover:text-text";
const ACTIVE = "bg-ink-4 text-text";

interface FlyItem { id: DrawingToolId; label: string; icon: ReactNode }
interface Group { key: string; title: string; icon: ReactNode; items: FlyItem[] }

const GROUPS: Group[] = [
  { key: "lines", title: "Lines", icon: ICONS.line, items: [
    { id: "trendline", label: "Trendline", icon: ICONS.line },
    { id: "ray", label: "Ray", icon: ICONS.ray },
    { id: "extended-line", label: "Extended Line", icon: ICONS.extended },
    { id: "horizontal-line", label: "Horizontal Line", icon: ICONS.horizontal },
    { id: "horizontal-ray", label: "Horizontal Ray", icon: ICONS.hray },
    { id: "vertical-line", label: "Vertical Line", icon: ICONS.vertical },
    { id: "cross-line", label: "Cross Line", icon: ICONS.cross },
  ] },
  { key: "fib", title: "Fibonacci", icon: ICONS.fib, items: [{ id: "fibonacci", label: "Retracement", icon: ICONS.fib }] },
  { key: "measure", title: "Measure", icon: ICONS.measure, items: [{ id: "measure", label: "Measure", icon: ICONS.measure }] },
  { key: "annotate", title: "Annotate", icon: ICONS.arrow, items: [{ id: "arrow", label: "Arrow", icon: ICONS.arrow }] },
];

export default function ProLeftRail(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [list, setList] = useState(false);
  const [pop, setPop] = useState<null | "color" | "width">(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open && !list && !pop) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(null); setList(false); setPop(null); } };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setList(false); setPop(null); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, list, pop]);

  const groupActive = (g: Group) => g.items.some((i) => i.id === p.activeTool);
  const lastPicked = useRef<Record<string, FlyItem>>({});
  const shownIcon = (g: Group) => (g.items.find((i) => i.id === p.activeTool) ?? lastPicked.current[g.key] ?? g.items[0]).icon;

  return (
    <div ref={ref} role="toolbar" aria-label="Chart drawing tools" className="relative flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-ink-2 py-2">
      <button type="button" title="Magnet: snap to open / high / low / close" aria-label="Magnet" aria-pressed={p.magnet} onClick={p.onToggleMagnet} className={`${BTN} ${p.magnet ? ACTIVE : ""}`}>{ICONS.magnet}</button>
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
            <div role="menu" className="absolute left-full top-0 z-40 ml-1 w-56 rounded-lg border border-border bg-ink-3 p-1.5 shadow-2xl">
              <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">{g.title}</p>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { lastPicked.current[g.key] = it; p.onSelectTool(p.activeTool === it.id ? null : it.id); setOpen(null); }}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] text-text-2 hover:bg-ink-4 ${p.activeTool === it.id ? "bg-ink-4" : ""}`}
                >
                  <span className="text-text-3">{it.icon}</span>
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button type="button" title="Rectangle" aria-label="Rectangle" aria-pressed={p.activeTool === "rectangle"} onClick={() => p.onSelectTool(p.activeTool === "rectangle" ? null : "rectangle")} className={`${BTN} ${p.activeTool === "rectangle" ? ACTIVE : ""}`}>{ICONS.rect}</button>

      <span className="my-1 h-px w-6 bg-ink-4" aria-hidden="true" />
      <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => p.onZoom("in")} className={BTN}>{ICONS.zoomIn}</button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => p.onZoom("out")} className={BTN}>{ICONS.zoomOut}</button>

      <span className="my-1 h-px w-6 bg-ink-4" aria-hidden="true" />
      <div className="relative">
        <button type="button" title="Colour" aria-label="Drawing colour" aria-expanded={pop === "color"} onClick={() => setPop(pop === "color" ? null : "color")} className={BTN}>
          <span className="h-4 w-4 rounded-[4px] border border-text-3" style={{ backgroundColor: p.style.color ?? "#2962ff" }} />
        </button>
        {pop === "color" && (
          <div className="absolute left-full top-0 z-40 ml-1 w-40 rounded-lg border border-border bg-ink-3 p-2 shadow-2xl">
            <div className="grid grid-cols-4 gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => { p.onStyle({ color: c }); setPop(null); }} className={`h-7 w-7 rounded-md border ${p.style.color === c ? "border-white" : "border-white/20"}`} style={{ backgroundColor: c }} />
              ))}
            </div>
            <button type="button" onClick={() => { p.onStyle({ color: null }); setPop(null); }} className="mt-2 w-full rounded-md py-1 text-[12px] text-text-3 hover:bg-ink-4 hover:text-text">Tool default colour</button>
          </div>
        )}
      </div>
      <div className="relative">
        <button type="button" title="Line width" aria-label="Line width" aria-expanded={pop === "width"} onClick={() => setPop(pop === "width" ? null : "width")} className={BTN}>
          <span className="block w-5 rounded bg-current" style={{ height: p.style.width + 1 }} />
        </button>
        {pop === "width" && (
          <div className="absolute left-full top-0 z-40 ml-1 w-32 rounded-lg border border-border bg-ink-3 p-1.5 shadow-2xl">
            {WIDTHS.map((w) => (
              <button key={w} type="button" onClick={() => { p.onStyle({ width: w }); setPop(null); }} className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-[13px] text-text-2 hover:bg-ink-4 ${p.style.width === w ? "bg-ink-4" : ""}`}>
                <span className="block w-8 rounded bg-current" style={{ height: w + 1 }} />
                {w}px
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="my-1 h-px w-6 bg-ink-4" aria-hidden="true" />
      <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo} className={`${BTN} disabled:cursor-not-allowed disabled:opacity-30`}>{ICONS.undo}</button>
      <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo} className={`${BTN} disabled:cursor-not-allowed disabled:opacity-30`}>{ICONS.redo}</button>
      <button type="button" title={p.locked ? "Unlock drawings" : "Lock drawings (no select, move or delete)"} aria-label="Lock drawings" aria-pressed={p.locked} onClick={p.onToggleLock} className={`${BTN} ${p.locked ? ACTIVE : ""}`}>{p.locked ? ICONS.lock : ICONS.unlock}</button>
      <button type="button" title="Eraser: click a drawing to remove it" aria-label="Eraser" aria-pressed={p.eraser} onClick={p.onToggleEraser} className={`${BTN} ${p.eraser ? ACTIVE : ""}`}>{ICONS.eraser}</button>

      <div className="flex-1" />
      <div className="relative">
        <button type="button" title="Object list" aria-label="Object list" aria-expanded={list} onClick={() => setList((v) => !v)} className={`${BTN} ${list ? ACTIVE : ""}`}>
          {ICONS.list}
          {p.objectCount > 0 && <span className="absolute right-0.5 top-0.5 rounded-full bg-gold px-1 text-[9px] font-semibold leading-3 text-text">{p.objectCount}</span>}
        </button>
        {list && (
          <div role="menu" aria-label="Object list" className="absolute bottom-0 left-full z-40 ml-1 w-60 rounded-lg border border-border bg-ink-3 p-1.5 shadow-2xl">
            <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">Objects</p>
            {p.drawingObjects.length === 0 && <p className="px-2 py-2 text-xs text-text-3">No objects drawn yet</p>}
            {[...p.drawingObjects].sort((a, b) => a.createdAt - b.createdAt).map((o, i) => (
              <div key={o.id} className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${o.id === p.selectedObjectId ? "bg-ink-4" : "hover:bg-ink-4"}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color }} aria-hidden="true" />
                <button type="button" onClick={() => p.onSelectObject(o.id)} className="flex-1 truncate text-left text-xs text-text-2">#{i + 1} {DRAWING_TOOL_LABEL[o.tool]}</button>
                <button type="button" aria-label={`Delete object #${i + 1}`} onClick={() => p.onDeleteObject(o.id)} className="text-xs text-text-3 opacity-0 hover:text-red-400 group-hover:opacity-100">×</button>
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
