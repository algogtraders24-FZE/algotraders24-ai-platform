// lib/chart-engine/panel-layout.ts
// Sprint D2.7.3, Phase 8 - turns a list of active panel ids into real pixel
// rows within the chart's actual (ResizeObserver-driven) plot height.
// "price" is always included and always first. Never a hardcoded layout -
// heights are proportional to each panel's PANEL_REGISTRY weight, computed
// fresh from whatever height the canvas actually has this render.
import { PANEL_REGISTRY } from "./indicators/panel-registry";
import type { ChartPanelId } from "./indicators/types";

export interface PanelRow {
  id: ChartPanelId;
  top: number;
  height: number;
}

const PANEL_GAP_PX = 4;

export function computePanelLayout(activePanels: ChartPanelId[], totalPlotHeight: number, gapPx = PANEL_GAP_PX): PanelRow[] {
  const ids: ChartPanelId[] = ["price", ...activePanels.filter((id) => id !== "price")];
  const totalWeight = ids.reduce((sum, id) => sum + PANEL_REGISTRY[id].heightWeight, 0);
  const totalGap = gapPx * Math.max(0, ids.length - 1);
  const usableHeight = Math.max(0, totalPlotHeight - totalGap);

  const rows: PanelRow[] = [];
  let top = 0;
  for (const id of ids) {
    const height = totalWeight > 0 ? (PANEL_REGISTRY[id].heightWeight / totalWeight) * usableHeight : 0;
    rows.push({ id, top, height });
    top += height + gapPx;
  }
  return rows;
}
