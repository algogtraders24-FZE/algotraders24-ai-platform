// services/api/AnalyticsApi.ts
// Sprint R1.2 - Phase 2: the client's only way to report an event, and only
// for the two types a client is allowed to report about itself
// (subscription_click, product_view - see AnalyticsEventService). Silently
// swallows failures: a tracking beacon must never surface an error to the
// user or block the UI it's attached to.
export class AnalyticsApi {
  static report(type: "subscription_click" | "product_view", metadata?: Record<string, unknown>): void {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, metadata }),
      keepalive: true,
    }).catch(() => {});
  }
}
