// services/api/AdminApi.ts
// Sprint L2.6 - Typed client access to the /api/private/admin/* routes.
// No caching (admin data must always reflect the current DB state, and
// every read here is behind an authorization check anyway).
import { ApiClient } from "./ApiClient";
import type { AdminUserSummary, AdminUserDetail } from "@/services/admin/AdminUserService";
import type { AdminSubscriptionRow } from "@/services/admin/AdminSubscriptionService";
import type { AdminKnowledgeRow, AdminKnowledgeStats } from "@/services/admin/AdminKnowledgeService";
import type { AdminAnalytics } from "@/services/admin/AdminAnalyticsService";
import type { AdminHealthReport } from "@/services/admin/AdminHealthService";
import type { AuditLogEntry } from "@/services/admin/AuditLogService";

export interface Page<T> {
  items: T[];
  total: number;
}

export class AdminApi {
  static async listUsers(params: { page: number; pageSize: number; q?: string }): Promise<Page<AdminUserSummary>> {
    return ApiClient.get<Page<AdminUserSummary>>("/api/private/admin/users", {
      query: { page: params.page, pageSize: params.pageSize, q: params.q },
    });
  }

  static async getUser(userId: string): Promise<AdminUserDetail> {
    const data = await ApiClient.get<{ user: AdminUserDetail }>(`/api/private/admin/users/${encodeURIComponent(userId)}`);
    return data.user;
  }

  static async setUserRole(userId: string, role: "user" | "admin"): Promise<AdminUserDetail> {
    const data = await ApiClient.patch<{ user: AdminUserDetail }>(`/api/private/admin/users/${encodeURIComponent(userId)}`, { role });
    return data.user;
  }

  static async setUserStatus(userId: string, status: "active" | "suspended"): Promise<AdminUserDetail> {
    const data = await ApiClient.patch<{ user: AdminUserDetail }>(`/api/private/admin/users/${encodeURIComponent(userId)}`, { status });
    return data.user;
  }

  static async listSubscriptions(params: { page: number; pageSize: number }): Promise<Page<AdminSubscriptionRow>> {
    return ApiClient.get<Page<AdminSubscriptionRow>>("/api/private/admin/subscriptions", {
      query: { page: params.page, pageSize: params.pageSize },
    });
  }

  static async cancelSubscription(userId: string) {
    return ApiClient.patch(`/api/private/admin/subscriptions/${encodeURIComponent(userId)}`, { action: "cancel" });
  }

  static async reactivateSubscription(userId: string) {
    return ApiClient.patch(`/api/private/admin/subscriptions/${encodeURIComponent(userId)}`, { action: "reactivate" });
  }

  static async overridePlan(userId: string, planId: string) {
    return ApiClient.patch(`/api/private/admin/subscriptions/${encodeURIComponent(userId)}`, { action: "override-plan", planId });
  }

  static async listKnowledge(params: { page: number; pageSize: number }): Promise<Page<AdminKnowledgeRow> & { stats: AdminKnowledgeStats }> {
    return ApiClient.get<Page<AdminKnowledgeRow> & { stats: AdminKnowledgeStats }>("/api/private/admin/knowledge", {
      query: { page: params.page, pageSize: params.pageSize },
    });
  }

  static async deleteKnowledge(knowledgeId: string): Promise<void> {
    await ApiClient.delete(`/api/private/admin/knowledge/${encodeURIComponent(knowledgeId)}`);
  }

  static async getAnalytics(): Promise<AdminAnalytics> {
    const data = await ApiClient.get<{ analytics: AdminAnalytics }>("/api/private/admin/analytics");
    return data.analytics;
  }

  static async getHealth(): Promise<AdminHealthReport> {
    const data = await ApiClient.get<{ report: AdminHealthReport }>("/api/private/admin/health");
    return data.report;
  }

  static async listAuditLogs(params: { page: number; pageSize: number; action?: string }): Promise<Page<AuditLogEntry>> {
    return ApiClient.get<Page<AuditLogEntry>>("/api/private/admin/audit-logs", {
      query: { page: params.page, pageSize: params.pageSize, action: params.action },
    });
  }
}
