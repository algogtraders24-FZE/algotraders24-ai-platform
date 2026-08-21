"use client";

// components/chart-engine/DrawingToolbar.tsx
// MT5 feature-parity Phase 1/1b - the drawing-tool selector: Cursor
// (normal pan/crosshair mode), Trend Line, Horizontal Line, Rectangle,
// Fibonacci Retracement, plus a "Delete selected" action enabled only
// when an object is actually selected. Deliberately a SEPARATE small
// toolbar from ChartToolbar.tsx (symbol/timeframe/indicators/fit/live)
// rather than folded into it - these are two different concerns (data/
// view controls vs. annotation tools), matching how MT5 itself keeps its
// own drawing toolbar visually distinct from the chart's main controls.
import { useEffect, useRef, useState } from "react";
import { DRAWING_TOOL_LABEL, type DrawingObject, type DrawingToolId } from "@/lib/chart-engine/drawing/types";
import { FIN_LABEL } from "@/components/ui/financial-typography";

export interface DrawingToolbarProps {
  activeTool: DrawingToolId | null;
  onSelectTool: (tool: DrawingToolId | null) => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  objectCount: number;
  onClearAll: () => void;
  /** Sprint D2.7.11 Phase 5e - MT5's Object List (Ctrl+B). */
  drawingObjects: readonly DrawingObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
}

const TOOLS: { id: DrawingToolId; label: string; glyph: string }[] = [
  { id: "trendline", label: "Trend Line", glyph: "╱" },
  { id: "horizontal-line", label: "Horizontal Line", glyph: "―" },
  { id: "rectangle", label: "Rectangle", glyph: "▭" },
  { id: "fibonacci", label: "Fibonacci Retracement", glyph: "F" },
];

export default function DrawingToolbar({
  activeTool,
  onSelectTool,
  hasSelection,
  onDeleteSelected,
  objectCount,
  onClearAll,
  drawingObjects,
  selectedObjectId,
  onSelectObject,
  onDeleteObject,
}: DrawingToolbarProps) {
  const [listOpen, setListOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Same dismissal pattern as ChartToolbar.tsx's Indicators/Templates
  // dropdowns - Escape and outside-click both close it.
  useEffect(() => {
    if (!listOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setListOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [listOpen]);

  // Oldest-first (creation order) - a stable, predictable order that never
  // reshuffles as objects are selected/deselected, matching how the
  // Templates dropdown's own list never reorders on interaction either.
  const orderedObjects = [...drawingObjects].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Chart drawing tools">
      <ToolButton
        active={activeTool === null}
        label="Cursor (Esc)"
        onClick={() => onSelectTool(null)}
        glyph="↖"
      />
      {TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          active={activeTool === tool.id}
          label={tool.label}
          onClick={() => onSelectTool(activeTool === tool.id ? null : tool.id)}
          glyph={tool.glyph}
        />
      ))}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        onClick={onDeleteSelected}
        disabled={!hasSelection}
        title="Delete the selected object (Delete key)"
        className="rounded-control border border-border bg-ink-3 px-2 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink-3 disabled:hover:text-text-3"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onClearAll}
        disabled={objectCount === 0}
        title="Remove every drawn object from this chart"
        className="rounded-control border border-border bg-ink-3 px-2 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink-3 disabled:hover:text-text-3"
      >
        Clear all{objectCount > 0 ? ` (${objectCount})` : ""}
      </button>

      <div className="relative" ref={listRef}>
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          aria-expanded={listOpen}
          aria-haspopup="true"
          title="Object List - every drawn object on this chart (Ctrl+B in real MT5)"
          className="rounded-control border border-border bg-ink-3 px-2 py-1 text-[11px] font-medium text-text-3 transition hover:bg-ink-4 hover:text-text"
        >
          Objects{objectCount > 0 ? ` (${objectCount})` : ""}
        </button>
        {listOpen && (
          <div role="menu" aria-label="Object list" className="absolute left-0 top-full z-10 mt-1 w-60 rounded-panel border border-border bg-ink-2 p-1.5 shadow-raised">
            {orderedObjects.length === 0 ? (
              <p className={`${FIN_LABEL} px-2 py-1.5`}>No objects drawn yet</p>
            ) : (
              orderedObjects.map((obj, i) => (
                <div
                  key={obj.id}
                  className={`group flex items-center gap-1.5 rounded-control px-2 py-1.5 ${obj.id === selectedObjectId ? "bg-ink-3" : "hover:bg-ink-3"}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: obj.color }} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => onSelectObject(obj.id)}
                    title={`Select object #${i + 1}`}
                    className="flex-1 truncate text-left text-xs text-text-2"
                  >
                    #{i + 1} {DRAWING_TOOL_LABEL[obj.tool]}
                    {obj.tool === "horizontal-line" ? ` @ ${obj.price}` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteObject(obj.id)}
                    aria-label={`Delete object #${i + 1} (${DRAWING_TOOL_LABEL[obj.tool]})`}
                    title="Delete this object"
                    className="rounded-control px-1.5 text-xs text-text-3 opacity-0 transition hover:text-signal-down group-hover:opacity-100"
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolButton({ active, label, onClick, glyph }: { active: boolean; label: string; onClick: () => void; glyph: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-control border text-sm transition ${
        active ? "border-gold/40 bg-gold/10 text-gold" : "border-border bg-ink-3 text-text-3 hover:bg-ink-4 hover:text-text"
      }`}
    >
      <span aria-hidden="true">{glyph}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}
