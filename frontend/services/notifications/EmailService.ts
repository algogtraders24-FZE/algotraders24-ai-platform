// services/notifications/EmailService.ts
// Real transactional email via Resend, for the one email this platform
// actually needs right now: confirming a marketplace purchase and telling
// the buyer where their license/download lives. Every call is best-effort
// from the caller's side (see the webhook route) - a failed email must
// never fail the purchase/license issuance that already succeeded.
import "server-only";
import { Resend } from "resend";
import { getSiteUrl } from "@/lib/payments/env";

// billing@ is a real, active mailbox on this domain (unlike a
// purchases@/no-reply@ address with no inbox behind it) - a buyer who
// replies to this email actually reaches someone.
const FROM_ADDRESS = "Algotraders24 AI <billing@algotraders24.ai>";

// Where to route the internal ops alert (see sendLicenseIssuanceFailureAlert
// below) - the team that would actually act on "a customer paid and got
// nothing" by manually completing the purchase, same as this session did
// by hand before this alert existed.
const OPS_ALERT_ADDRESS = "support@algotraders24.ai";

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

// AT24_EMAIL_COMMUNICATION_RECONCILIATION.md's top finding: if
// issueLicenseForPurchase() throws AFTER Stripe has already charged the
// buyer (e.g. a signing-key misconfiguration, a DB error), the webhook
// only console.error's and returns 500 - nobody is alerted that a paying
// customer has no license. This session hit exactly that failure mode
// live and fixed it by hand (a diagnostic script + manual DB write); this
// alert exists so that never has to happen silently again. Sent to the
// team, never the buyer - the buyer's own experience (redirect, no
// confirmation email) is unchanged until this is manually resolved.
export async function sendLicenseIssuanceFailureAlert(params: {
  buyerEmail: string;
  tradingSystemId: string;
  amount: number;
  currency: string;
  providerRef: string;
  errorMessage: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set - skipping license issuance failure alert");
    return;
  }

  const price = `${params.amount.toFixed(2)} ${params.currency}`;

  await client.emails.send({
    from: FROM_ADDRESS,
    to: OPS_ALERT_ADDRESS,
    subject: `[ACTION NEEDED] License issuance failed after payment - ${params.tradingSystemId}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
        <h1 style="font-size: 18px; color: #b91c1c;">A customer paid but did not receive a license</h1>
        <p>Stripe charged this customer successfully, but issuing their license failed. They have received no confirmation email and cannot see this purchase in their dashboard yet. This needs manual follow-up.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Buyer email</td><td style="padding: 8px 0; text-align: right;">${escapeHtml(params.buyerEmail)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Product</td><td style="padding: 8px 0; text-align: right;">${escapeHtml(params.tradingSystemId)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Amount charged</td><td style="padding: 8px 0; text-align: right;">${price}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Stripe session</td><td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 11px;">${escapeHtml(params.providerRef)}</td></tr>
        </table>
        <p style="color: #666; font-size: 13px;">Error: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${escapeHtml(params.errorMessage)}</code></p>
      </div>
    `,
  });
}

// Covers both a fresh subscribe and every renewal - both go through
// SubscriptionActionService.activateFromPayment(), called from
// checkout.session.completed (subscription mode) and
// customer.subscription.updated alike, so one email function naturally
// handles both triggers without duplicating the "your plan is active"
// message.
export async function sendSubscriptionActiveEmail(params: {
  to: string;
  buyerName: string;
  planName: string;
  amount: number;
  currency: string;
  periodEnd: Date;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set - skipping subscription active email");
    return;
  }

  const dashboardUrl = `${getSiteUrl()}/dashboard`;
  const price = `${params.amount.toFixed(2)} ${params.currency}`;
  const renewsOn = params.periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  await client.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `Your ${params.planName} subscription is active`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h1 style="font-size: 20px;">Thanks, ${escapeHtml(params.buyerName)} - your subscription is active</h1>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px 0; color: #666;">Plan</td><td style="padding: 8px 0; text-align: right;">${escapeHtml(params.planName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0; text-align: right;">${price}</td></tr>
          <tr><td style="padding: 8px 0; color: #666;">Renews on</td><td style="padding: 8px 0; text-align: right;">${renewsOn}</td></tr>
        </table>
        <a href="${dashboardUrl}" style="display: inline-block; background: #d4af37; color: #1a1a1a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Go to dashboard</a>
        <p style="margin-top: 32px; font-size: 12px; color: #999;">Algotraders24 AI &middot; Need help? Reply to this email or reach us at support@algotraders24.ai</p>
      </div>
    `,
  });
}

export async function sendSubscriptionCancelledEmail(params: {
  to: string;
  buyerName: string;
  planName: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set - skipping subscription cancelled email");
    return;
  }

  await client.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `Your ${params.planName} subscription has been cancelled`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h1 style="font-size: 20px;">Your subscription has been cancelled</h1>
        <p>${escapeHtml(params.buyerName)}, your <strong>${escapeHtml(params.planName)}</strong> subscription is now cancelled and will not renew. You can resubscribe anytime from your dashboard.</p>
        <a href="${getSiteUrl()}/pricing" style="display: inline-block; background: #d4af37; color: #1a1a1a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View plans</a>
        <p style="margin-top: 32px; font-size: 12px; color: #999;">Algotraders24 AI &middot; Need help? Reply to this email or reach us at support@algotraders24.ai</p>
      </div>
    `,
  });
}

// AU03/AU-credit-block from AT24_EMAIL_COMMUNICATION_RECONCILIATION.md's
// "second-best candidate": AutomationRun reaching FAILED or CREDIT_BLOCKED
// is a real, terminal, per-run event with zero notification today - the
// owner otherwise only finds out by opening the run history themselves.
// Deliberately does NOT cover SUCCEEDED (the reconciliation doc's own
// note: a success email on every run would need an opt-in preference this
// system doesn't have yet - failure alerting doesn't have that problem,
// since silence-by-default already means "nothing to report").
export async function sendAutomationRunFailedEmail(params: {
  to: string;
  buyerName: string;
  automationName: string;
  status: "FAILED" | "CREDIT_BLOCKED";
  errorMessage: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY not set - skipping automation run failed email");
    return;
  }

  const dashboardUrl = `${getSiteUrl()}/dashboard/automation`;
  const reason = params.status === "CREDIT_BLOCKED" ? "ran out of credits" : "failed";

  await client.emails.send({
    from: FROM_ADDRESS,
    to: params.to,
    subject: `Your automation "${params.automationName}" ${reason}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
        <h1 style="font-size: 20px;">${escapeHtml(params.buyerName)}, your automation ${reason}</h1>
        <p><strong>${escapeHtml(params.automationName)}</strong> did not complete successfully on its last run.</p>
        <p style="color: #666; font-size: 13px;">${escapeHtml(params.errorMessage)}</p>
        <a href="${dashboardUrl}" style="display: inline-block; background: #d4af37; color: #1a1a1a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">View automation</a>
        <p style="margin-top: 32px; font-size: 12px; color: #999;">Algotraders24 AI &middot; Need help? Reply to this email or reach us at support@algotraders24.ai</p>
      </div>
    `,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
