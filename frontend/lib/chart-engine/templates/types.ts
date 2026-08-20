// lib/chart-engine/templates/types.ts
// Sprint D2.7.11 Phase 4 - the client-side shape of a saved chart
// template, mirroring services/chart/chart-template.service.ts's own
// ChartTemplateData exactly (never a second, drifting shape).
import type { DrawingObject } from "../drawing/types";

export interface ChartTemplate {
  id: string;
  name: string;
  indicatorKeys: string[];
  drawingObjects: DrawingObject[];
  updatedAt: string;
}
