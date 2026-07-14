// config/plan-limits.ts
// Sprint 14E - Plan entitlements and presentation metadata.
// Pricing, names, and feature lists live in the database (Plan table).
// Limits are product configuration, not user data, so they live in code until
// entitlement enforcement lands in Sprint 15A.
import type { PlanId } from "@/types/billing";

export interface PlanLimits {
  description: string;
  priceYearly: number;
  aiCredits: number;
  maxAgents: number;
  maxAutomations: number;
  maxKnowledgeDocuments: number;
  storageLimit: number; // MB
  apiAccess: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
  teamMembers: number;
  highlighted: boolean;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    description: "Get started with core AI trading tools.",
    priceYearly: 0,
    aiCredits: 500,
    maxAgents: 1,
    maxAutomations: 2,
    maxKnowledgeDocuments: 10,
    storageLimit: 100,
    apiAccess: false,
    prioritySupport: false,
    customBranding: false,
    teamMembers: 1,
    highlighted: false,
  },
  pro: {
    description: "For active traders scaling their AI workflows.",
    priceYearly: 279,
    aiCredits: 10000,
    maxAgents: 5,
    maxAutomations: 25,
    maxKnowledgeDocuments: 200,
    storageLimit: 5000,
    apiAccess: true,
    prioritySupport: false,
    customBranding: false,
    teamMembers: 3,
    highlighted: true,
  },
  elite: {
    description: "Advanced multi-agent trading at full throttle.",
    priceYearly: 949,
    aiCredits: 50000,
    maxAgents: 20,
    maxAutomations: 100,
    maxKnowledgeDocuments: 1000,
    storageLimit: 25000,
    apiAccess: true,
    prioritySupport: true,
    customBranding: true,
    teamMembers: 10,
    highlighted: false,
  },
  enterprise: {
    description: "Custom limits, SLAs, and dedicated support.",
    priceYearly: 4790,
    aiCredits: 500000,
    maxAgents: 100,
    maxAutomations: 1000,
    maxKnowledgeDocuments: 100000,
    storageLimit: 500000,
    apiAccess: true,
    prioritySupport: true,
    customBranding: true,
    teamMembers: 100,
    highlighted: false,
  },
};

export function isPlanId(value: string): value is PlanId {
  return value === "free" || value === "pro" || value === "elite" || value === "enterprise";
}