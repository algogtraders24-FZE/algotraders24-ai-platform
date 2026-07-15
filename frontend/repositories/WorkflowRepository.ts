// repositories/WorkflowRepository.ts
// Sprint 14E — Workflow (Automation dashboard) entities + mock fallback.
import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";

export interface WorkflowStepEntity {
  id: string;
  actionId: string;
  label: string;
}

export interface WorkflowEntity extends BaseEntity {
  userId: string;
  name: string;
  description: string;
  trigger: "manual" | "scheduled" | "event";
  schedule: string | null;
  status: "active" | "paused" | "draft";
  steps: WorkflowStepEntity[];
}

export interface WorkflowRunEntity extends BaseEntity {
  userId: string;
  workflowId: string;
  status: "queued" | "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  log: string[];
}

export interface WorkflowQueueEntity extends BaseEntity {
  workflowId: string;
  status: "queued" | "running" | "success" | "failed";
  enqueuedAt: string;
}

const SEED: WorkflowEntity[] = [
  {
    id: "wf_seed_1",
    userId: "u1",
    name: "Daily market digest",
    description: "Mock fallback workflow.",
    trigger: "scheduled",
    schedule: "0 7 * * *",
    status: "active",
    steps: [{ id: "s1", actionId: "analyze-market", label: "Analyze" }],
    createdAt: "2026-05-20T09:00:00.000Z",
    updatedAt: "2026-05-20T09:00:00.000Z",
  },
];

export class WorkflowRepository extends BaseRepository<WorkflowEntity> {
  protected entityName = "workflow";
  constructor() {
    super(SEED);
  }
  async findByUser(userId: string): Promise<WorkflowEntity[]> {
    const all = await this.findAll();
    return all.filter((w) => w.userId === userId);
  }
}


