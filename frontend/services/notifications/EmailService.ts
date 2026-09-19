// services/notifications/EmailService.ts
// Real transactional email via Resend, for the one email this platform
// actually needs right now: confirming a marketplace purchase and telling
// the buyer where their license/download lives. Every call is best-effort
// from the caller's side (see the webhook route) - a failed email must
// never fail the purchase/license issuance that already succeeded.
import "server-only";
import { Resend } from "resend";
import { getSiteUrl } from "@/lib/payments/env";

const FROM_ADDRESS = "Algotraders24 AI <purchases@algotraders24.ai>";

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendPurchaseConfirmationEmail(params: {
  to: string;
  buyerName: string;
  productName: string;
  amount: number;
  currency: string;
  licenseId: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set - skipping purchase confirmation email");
    return;
  }

  const dashboardUrl = `${getSiteUrl()}/dashboard/purchases`;
  const price = `${params.amount.toFixed(2)} ${params.currency}`;

  await client.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `Your purchase: ${params.productName}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h1 style="font-size: 20px;">Thanks for your purchase, ${escapeHtml(params.buyerName)}!</h1>
        <p>Your license for <strong>${escapeHtml(params.productName)}</strong> has been issued.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Product</td><td style="padding: 8px 0; text-align: right;">${escapeHtml(params.productName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; text-align: right;">${price}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">License ID</td><td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${escapeHtml(params.licenseId)}</td></tr>
        </table>
        <a href="${dashboardUrl}" style="display: inline-block; background: #d4af37; color: #1a1a1a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View your license</a>
        <p style="margin-top: 32px; font-size: 12px; color: #999;">Algotraders24 AI &middot; Need help? Reply to this email or reach us at support@algotraders24.ai</p>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
