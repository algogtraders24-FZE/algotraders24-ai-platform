// services/billing/providers/NowPaymentsProvider.ts
// Sprint L2.7 - Phase 3: real NOWPayments crypto invoice integration. No
// official Node SDK exists for NOWPayments, so this calls their documented
// REST API directly via fetch - same isConfigured()-gated, typed-error
// pattern as StripeProvider. Only the three features the brief actually
// asks for are implemented (invoice creation, payment status, IPN
// signature verification) - no speculative extras.
import crypto from "node:crypto";
import { loadNowPaymentsEnv, getSiteUrl } from "@/lib/payments/env";
import { PaymentProviderError } from "@/lib/payments/errors";

const API_BASE = "https://api.nowpayments.io/v1";

export interface NowPaymentsInvoice {
  id: string;
  invoiceUrl: string;
}

export interface NowPaymentsPaymentStatus {
  paymentId: string;
  paymentStatus: string; // e.g. "waiting" | "confirming" | "confirmed" | "finished" | "failed" | "expired"
  orderId: string | null;
}

// NOWPayments signs the IPN body as JSON with keys sorted recursively and
// no whitespace - this must match their exact serialization or every real
// signature will fail to verify.
function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export class NowPaymentsProvider {
  isConfigured(): boolean {
    return loadNowPaymentsEnv() !== null;
  }

  async createInvoice(params: {
    userId: string;
    planId: string;
    priceUsd: number;
    orderId: string;
  }): Promise<NowPaymentsInvoice> {
    const env = loadNowPaymentsEnv();
    if (!env) {
      throw new PaymentProviderError("unconfigured", "NOWPayments is not configured (missing NOWPAYMENTS_API_KEY/NOWPAYMENTS_IPN_SECRET)", "nowpayments");
    }
    if (params.priceUsd <= 0) {
      throw new PaymentProviderError("invalid_response", "priceUsd must be a positive amount", "nowpayments");
    }

    const siteUrl = getSiteUrl();
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/invoice`, {
        method: "POST",
        headers: { "x-api-key": env.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          price_amount: params.priceUsd,
          price_currency: "usd",
          order_id: params.orderId,
          order_description: `Plan: ${params.planId}`,
          ipn_callback_url: `${siteUrl}/api/webhooks/nowpayments`,
          success_url: `${siteUrl}/dashboard/billing?checkout=success`,
          cancel_url: `${siteUrl}/dashboard/billing?checkout=cancel`,
        }),
      });
    } catch (error) {
      throw new PaymentProviderError("http_error", "Failed to reach NOWPayments", "nowpayments", error);
    }

    if (res.status === 401 || res.status === 403) {
      throw new PaymentProviderError("auth", "NOWPayments rejected the API key", "nowpayments");
    }
    if (!res.ok) {
      throw new PaymentProviderError("http_error", `NOWPayments invoice creation failed with ${res.status}`, "nowpayments");
    }

    const body = (await res.json().catch(() => null)) as { id?: string; invoice_url?: string } | null;
    if (!body?.id || !body.invoice_url) {
      throw new PaymentProviderError("invalid_response", "NOWPayments returned an unexpected invoice response", "nowpayments");
    }
    return { id: body.id, invoiceUrl: body.invoice_url };
  }

  async getPaymentStatus(paymentId: string): Promise<NowPaymentsPaymentStatus> {
    const env = loadNowPaymentsEnv();
    if (!env) {
      throw new PaymentProviderError("unconfigured", "NOWPayments is not configured", "nowpayments");
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/payment/${encodeURIComponent(paymentId)}`, {
        headers: { "x-api-key": env.apiKey },
      });
    } catch (error) {
      throw new PaymentProviderError("http_error", "Failed to reach NOWPayments", "nowpayments", error);
    }

    if (!res.ok) {
      throw new PaymentProviderError("http_error", `NOWPayments status lookup failed with ${res.status}`, "nowpayments");
    }
    const body = (await res.json().catch(() => null)) as { payment_id?: string; payment_status?: string; order_id?: string } | null;
    if (!body?.payment_id || !body.payment_status) {
      throw new PaymentProviderError("invalid_response", "NOWPayments returned an unexpected status response", "nowpayments");
    }
    return { paymentId: body.payment_id, paymentStatus: body.payment_status, orderId: body.order_id ?? null };
  }

  // Real HMAC-SHA512 verification per NOWPayments' IPN spec - throws on any
  // mismatch, never processes an unverified payload.
  verifyIpnSignature(rawBody: unknown, signatureHeader: string | null): boolean {
    const env = loadNowPaymentsEnv();
    if (!env) {
      throw new PaymentProviderError("unconfigured", "NOWPayments is not configured", "nowpayments");
    }
    if (!signatureHeader) return false;

    const sorted = sortObjectKeys(rawBody);
    const serialized = JSON.stringify(sorted);
    const expected = crypto.createHmac("sha512", env.ipnSecret).update(serialized).digest("hex");

    try {
      return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signatureHeader, "hex"));
    } catch {
      return false; // malformed header (wrong length/encoding) - never a match
    }
  }
}

export const nowPaymentsProvider = new NowPaymentsProvider();
