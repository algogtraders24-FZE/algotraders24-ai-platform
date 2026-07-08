// config/automation.config.ts
// AI Automation Engine — configuration

import type { WorkflowTrigger } from "@/types/automation";

export const AUTOMATION_CONFIG = {
  version: "1.0.0-foundation",
  maxConcurrentRuns: 3,
  maxQueueSize: 50,
  retryCount: 2,
  defaultTrigger: "manual" as WorkflowTrigger,
} as const;

export const TRIGGERS: WorkflowTrigger[] = ["manual", "scheduled", "event"];

/** Preset schedule options for the scheduler foundation. */
export const SCHEDULE_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Daily 07:00", value: "0 7 * * *" },
  { label: "Weekdays 09:00", value: "0 9 * * 1-5" },
  { label: "Weekly Sun 18:00", value: "0 18 * * 0" },
] as const;