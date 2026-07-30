// services/api/BillingApi.ts
// Sprint 14E - Typed access to the billing/plan/subscription private API routes.
// Sprint L2.5 - Added real usage/entitlements fetch and subscription
// mutation actions (cancel/reactivate/change-plan).
import { ApiClient, type RequestOptions } from "./ApiClient";
import type { Entitlements } from "@/types/billing";

export interface ApiPlan {
  id: string;
  name: string;
  price: number;
  interval: string;
  features: string[];
  sortOrder: number;
}

export interface ApiBillingRecord {
  id: string;
  userId: string;
  planId: string;
  status: "active" | "canceled" | "past_due";
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSubscription {
  id: string;
  userId: string;
  planId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSubscriptionEnvelope {
  subscription: ApiSubscription | null;
  planId: string;
}

interface ListEnvelope<T> {
  items: T[];
  total: number;
  mode?: string;
}

const PLANS_TTL_MS = 5 * 60 * 1000;
const BILLING_TTL_MS = 30 * 1000;
const SUBSCRIPTION_TTL_MS = 30 * 1000;

export class BillingApi {
  static async listPlans(options: RequestOptions = {}): Promise<ApiPlan[]> {
    const data = await ApiClient.get<ListEnvelope<ApiPlan>>(
      "/api/private/plans",
      { cacheTtlMs: PLANS_TTL_MS, retries: 2, ...options }
    );
    return data.items;
  }

  static async listBillingRecords(
    options: RequestOptions = {}
  ): Promise<ApiBillingRecord[]> {
    const data = await ApiClient.get<ListEnvelope<ApiBillingRecord>>(
      "/api/private/billing",
      { cacheTtlMs: BILLING_TTL_MS, retries: 2, ...options }
    );
    return data.items;
  }

  static async getSubscription(
    options: RequestOptions = {}
  ): Promise<ApiSubscriptionEnvelope> {
    return ApiClient.get<ApiSubscriptionEnvelope>(
      "/api/private/subscription",
      { cacheTtlMs: SUBSCRIPTION_TTL_MS, retries: 2, ...options }
    );
  }

  static async getUsage(options: RequestOptions = {}): Promise<Entitlements> {
    const data = await ApiClient.get<{ entitlements: Entitlements }>(
      "/api/private/billing/usage",
      { cacheTtlMs: SUBSCRIPTION_TTL_MS, retries: 2, ...options }
    );
    return data.entitlements;
  }

  static async cancelSubscription(options: RequestOptions = {}): Promise<ApiSubscription> {
    const data = await ApiClient.patch<{ subscription: ApiSubscription }>(
      "/api/private/subscription",
      { action: "cancel" },
      options
    );
    return data.subscription;
  }

  static async reactivateSubscription(options: RequestOptions = {}): Promise<ApiSubscription> {
    const data = await ApiClient.patch<{ subscription: ApiSubscription }>(
      "/api/private/subscription",
      { action: "reactivate" },
      options
    );
    return data.subscription;
  }

  static async changePlan(planId: string, options: RequestOptions = {}): Promise<ApiSubscription> {
    const data = await ApiClient.patch<{ subscription: ApiSubscription }>(
      "/api/private/subscription",
      { action: "change-plan", planId },
      options
    );
    return data.subscription;
  }

  static invalidate(): void {
    ApiClient.invalidate("/api/private/plans");
    ApiClient.invalidate("/api/private/billing");
    ApiClient.invalidate("/api/private/subscription");
  }
}