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
import type { DrawingToolId } from "@/lib/chart-engine/drawing/types";

export interface DrawingToolbarProps {
  activeTool: DrawingToolId | null;
  onSelectTool: (tool: DrawingToolId | null) => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
  objectCount: number;
  onClearAll: () => void;
}

const TOOLS: { id: DrawingToolId; label: string; glyph: string }[] = [
  { id: "trendline", label: "Trend Line", glyph: "╱" },
  { id: "horizontal-line", label: "Horizontal Line", glyph: "―" },
  { id: "rectangle", label: "Rectangle", glyph: "▭" },
  { id: "fibonacci", label: "Fibonacci Retracement", glyph: "F" },
];

export default function DrawingToolbar({ activeTool, onSelectTool, hasSelection, onDeleteSelected, objectCount, onClearAll }: DrawingToolbarProps) {
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
