// services/notifications/EmailService.ts
// Real transactional email via Resend. Every call is best-effort from the
// caller's side (see the webhook route) - a failed email must never fail
// the purchase/license issuance/domain action that already succeeded.
import "server-only";
import { Resend } from "resend";
import { getSiteUrl } from "@/lib/payments/env";
import { recordEmailLog } from "./EmailLogService";

// billing@ is a real, active mailbox on this domain (unlike a
// purchases@/no-reply@ address with no inbox behind it) - a buyer who
// replies to this email actually reaches someone.
const FROM_ADDRESS = "Algotraders24 AI <billing@algotraders24.ai>";

// Where to route internal ops alerts (license issuance failure, new support
// tickets) - the team that would actually act on them.
const OPS_ALERT_ADDRESS = "support@algotraders24.ai";

function getClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

// ---------------------------------------------------------------------
// Shared layout - every email body renders through this so brand chrome
// (font, button style, footer) lives in one place instead of being
// hand-copied into each template.
// ---------------------------------------------------------------------

const DEFAULT_FOOTER = `<p style="margin-top: 32px; font-size: 12px; color: #999;">Algotraders24 AI &middot; Need help? Reply to this email or reach us at support@algotraders24.ai</p>`;

function renderLayout(params: {
  title: string;
  titleColor?: string;
  maxWidth?: number;
  bodyHtml: string;
  cta?: { text: string; url: string };
  /** Pass null to omit the footer entirely (e.g. the security-sensitive
   *  password-changed email, which intentionally has no "reply to this
   *  email" invitation). Omit the field to get the default footer. */
  footerHtml?: string | null;
}): string {
  const maxWidth = params.maxWidth ?? 480;
  const titleColor = params.titleColor ?? "#1a1a1a";
  const footer = params.footerHtml === null ? "" : (params.footerHtml ?? DEFAULT_FOOTER);
  const cta = params.cta
    ? `<a href="${params.cta.url}" style="display: inline-block; background: #d4af37; color: #1a1a1a; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">${escapeHtml(params.cta.text)}</a>`
    : "";
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: ${maxWidth}px; margin: 0 auto; color: #1a1a1a;">
      <h1 style="font-size: 20px; color: ${titleColor};">${params.title}</h1>
      ${params.bodyHtml}
      ${cta}
      ${footer}
    </div>
  `;
}

function detailTable(rows: [label: string, value: string][]): string {
  const cells = rows
    .map(([label, value]) => `<tr><td style="padding: 8px 0; color: #666;">${label}</td><td style="padding: 8px 0; text-align: right;">${value}</td></tr>`)
    .join("");
  return `<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">${cells}</table>`;
}

/** Every send goes through this one chokepoint so delivery outcomes are
 *  logged uniformly (EmailLogService) without every template function
 *  re-implementing the same try/log/return dance. Never throws - a logging
 *  failure or a Resend failure both resolve to a no-op for the caller,
 *  exactly as before this existed. */
async function dispatch(params: {
  type: string;
  to: string;
  subject: string;
  html: string;
  recipientUserId?: string;
  dedupeKey?: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY not set - skipping ${params.type} email`);
    await recordEmailLog({ type: params.type, recipientEmail: params.to, recipientUserId: params.recipientUserId, dedupeKey: params.dedupeKey, status: "SKIPPED" });
    return;
  }

  try {
    const result = await client.emails.send({ from: FROM_ADDRESS, to: params.to, subject: params.subject, html: params.html });
    await recordEmailLog({
      type: params.type,
      recipientEmail: params.to,
      recipientUserId: params.recipientUserId,
      dedupeKey: params.dedupeKey,
      status: result.error ? "FAILED" : "SENT",
      providerMessageId: result.data?.id,
      errorMessage: result.error?.message,
    });
  } catch (err) {
    await recordEmailLog({
      type: params.type,
      recipientEmail: params.to,
      recipientUserId: params.recipientUserId,
      dedupeKey: params.dedupeKey,
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function sendPurchaseConfirmationEmail(params: {
  to: string;
  buyerName: string;
  productName: string;
  amount: number;
  currency: string;
  licenseId: string;
}): Promise<void> {
  const dashboardUrl = `${getSiteUrl()}/dashboard/purchases`;
  const price = `${params.amount.toFixed(2)} ${params.currency}`;

  const html = renderLayout({
    title: `Thanks for your purchase, ${escapeHtml(params.buyerName)}!`,
    bodyHtml: `
      <p>Your license for <strong>${escapeHtml(params.productName)}</strong> has been issued.</p>
      ${detailTable([
        ["Product", escapeHtml(params.productName)],
        ["Amount", price],
        ["License ID", `<span style="font-family: monospace; font-size: 12px;">${escapeHtml(params.licenseId)}</span>`],
      ])}
    `,
    cta: { text: "View your license", url: dashboardUrl },
  });

  await dispatch({ type: "purchase_confirmation", to: params.to, subject: `Your purchase: ${params.productName}`, html });
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
  const price = `${params.amount.toFixed(2)} ${params.currency}`;

  const html = renderLayout({
    title: "A customer paid but did not receive a license",
    titleColor: "#b91c1c",
    maxWidth: 560,
    bodyHtml: `
      <p>Stripe charged this customer successfully, but issuing their license failed. They have received no confirmation email and cannot see this purchase in their dashboard yet. This needs manual follow-up.</p>
      ${detailTable([
        ["Buyer email", escapeHtml(params.buyerEmail)],
        ["Product", escapeHtml(params.tradingSystemId)],
        ["Amount charged", price],
        ["Stripe session", `<span style="font-family: monospace; font-size: 11px;">${escapeHtml(params.providerRef)}</span>`],
      ])}
      <p style="color: #666; font-size: 13px;">Error: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${escapeHtml(params.errorMessage)}</code></p>
    `,
    footerHtml: "",
  });

  await dispatch({ type: "license_issuance_failure_alert", to: OPS_ALERT_ADDRESS, subject: `[ACTION NEEDED] License issuance failed after payment - ${params.tradingSystemId}`, html });
}

// Found live in production (2026-09-22): a real NOWPayments crypto
// subscription payment finished on the provider's side, but the
// NOWPayments webhook's subscription branch had no equivalent of
// sendLicenseIssuanceFailureAlert - a failed/never-arriving
// activateFromPayment() call was completely silent, leaving a paying
// customer on the free plan with no record anywhere that anything had gone
// wrong. This closes that gap for both providers' subscription paths.
export async function sendSubscriptionActivationFailureAlert(params: {
  userId: string;
  planId: string;
  provider: "stripe" | "nowpayments";
  providerRef: string;
  errorMessage: string;
}): Promise<void> {
  const html = renderLayout({
    title: "A subscription payment succeeded but activation failed",
    titleColor: "#b91c1c",
    maxWidth: 560,
    bodyHtml: `
      <p>${params.provider === "nowpayments" ? "NOWPayments" : "Stripe"} confirmed this payment, but writing the Subscription record failed. The customer is still on their old plan and has received no confirmation email. This needs manual follow-up.</p>
      ${detailTable([
        ["User ID", `<span style="font-family: monospace; font-size: 12px;">${escapeHtml(params.userId)}</span>`],
        ["Plan", escapeHtml(params.planId)],
        ["Provider", params.provider],
        ["Provider ref", `<span style="font-family: monospace; font-size: 11px;">${escapeHtml(params.providerRef)}</span>`],
      ])}
      <p style="color: #666; font-size: 13px;">Error: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${escapeHtml(params.errorMessage)}</code></p>
    `,
    footerHtml: "",
  });

  await dispatch({ type: "subscription_activation_failure_alert", to: OPS_ALERT_ADDRESS, subject: `[ACTION NEEDED] Subscription activation failed after payment - ${params.userId}`, html });
}

// Payment Verification/Hardening - found via audit, not yet observed in
// production: if a Stripe checkout.session.completed event's metadata is
// ever missing/malformed a required field (buyerId/listingId/... for a
// marketplace purchase, userId/planId for a subscription), the webhook's
// existence-check silently skips processing - no error, no alert, nothing.
// A buyer could be charged with zero record anywhere that anything went
// wrong. This closes that silent-skip gap the same way
// sendLicenseIssuanceFailureAlert closes the license-issuance-failure one.
export async function sendWebhookMetadataMissingAlert(params: {
  provider: "stripe" | "nowpayments";
  eventContext: string;
  providerRef: string;
  missingFields: string[];
  rawMetadata: Record<string, unknown>;
}): Promise<void> {
  const html = renderLayout({
    title: "A payment webhook fired with missing/malformed metadata",
    titleColor: "#b91c1c",
    maxWidth: 560,
    bodyHtml: `
      <p>${params.provider === "nowpayments" ? "NOWPayments" : "Stripe"} sent a ${escapeHtml(params.eventContext)} event, but required metadata was missing or malformed, so nothing was processed - no Purchase, no Entitlement, no License, no subscription activation. If this event represents a real successful payment, the customer was charged with no record of it. This needs manual follow-up.</p>
      ${detailTable([
        ["Provider", params.provider],
        ["Event context", escapeHtml(params.eventContext)],
        ["Provider ref", `<span style="font-family: monospace; font-size: 11px;">${escapeHtml(params.providerRef)}</span>`],
        ["Missing/invalid fields", escapeHtml(params.missingFields.join(", ") || "(none identified)")],
      ])}
      <p style="color: #666; font-size: 13px;">Raw metadata: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; word-break: break-all;">${escapeHtml(JSON.stringify(params.rawMetadata))}</code></p>
    `,
    footerHtml: "",
  });

  await dispatch({ type: "webhook_metadata_missing_alert", to: OPS_ALERT_ADDRESS, subject: `[ACTION NEEDED] ${params.provider} webhook metadata missing - ${params.eventContext}`, html });
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
  const dashboardUrl = `${getSiteUrl()}/dashboard`;
  const price = `${params.amount.toFixed(2)} ${params.currency}`;
  const renewsOn = params.periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const html = renderLayout({
    title: `Thanks, ${escapeHtml(params.buyerName)} - your subscription is active`,
    bodyHtml: detailTable([
      ["Plan", escapeHtml(params.planName)],
      ["Amount", price],
      ["Renews on", renewsOn],
    ]),
    cta: { text: "Go to dashboard", url: dashboardUrl },
  });

  await dispatch({ type: "subscription_active", to: params.to, subject: `Your ${params.planName} subscription is active`, html });
}

export async function sendSubscriptionCancelledEmail(params: {
  to: string;
  buyerName: string;
  planName: string;
}): Promise<void> {
  const html = renderLayout({
    title: "Your subscription has been cancelled",
    bodyHtml: `<p>${escapeHtml(params.buyerName)}, your <strong>${escapeHtml(params.planName)}</strong> subscription is now cancelled and will not renew. You can resubscribe anytime from your dashboard.</p>`,
    cta: { text: "View plans", url: `${getSiteUrl()}/pricing` },
  });

  await dispatch({ type: "subscription_cancelled", to: params.to, subject: `Your ${params.planName} subscription has been cancelled`, html });
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
  const dashboardUrl = `${getSiteUrl()}/dashboard/automation`;
  const reason = params.status === "CREDIT_BLOCKED" ? "ran out of credits" : "failed";

  const html = renderLayout({
    title: `${escapeHtml(params.buyerName)}, your automation ${reason}`,
    bodyHtml: `
      <p><strong>${escapeHtml(params.automationName)}</strong> did not complete successfully on its last run.</p>
      <p style="color: #666; font-size: 13px;">${escapeHtml(params.errorMessage)}</p>
    `,
    cta: { text: "View automation", url: dashboardUrl },
  });

  await dispatch({ type: "automation_run_failed", to: params.to, subject: `Your automation "${params.automationName}" ${reason}`, html });
}

// A01/A02 from AT24_EMAIL_COMMUNICATION_RECONCILIATION.md - Supabase sends
// its own account-verification email, but nothing welcomes a new user or
// orients them once they've actually signed up. Sent from signUpAction
// immediately on success, independent of whether they've verified their
// email yet.
export async function sendWelcomeEmail(params: { to: string; name: string }): Promise<void> {
  const html = renderLayout({
    title: `Welcome, ${escapeHtml(params.name)}!`,
    bodyHtml: `<p>Your Algotraders24 AI account is ready. Check your inbox for a separate verification email to confirm your address, then explore the AI Assistant, Market Intelligence, and the Marketplace from your dashboard.</p>`,
    cta: { text: "Go to dashboard", url: `${getSiteUrl()}/dashboard` },
  });

  await dispatch({ type: "welcome", to: params.to, subject: "Welcome to Algotraders24 AI", html });
}

// A04 - a security notification (not the reset link itself, which Supabase
// already sends): confirms to the account owner that their password was
// just changed, so they'd notice if it wasn't actually them.
export async function sendPasswordChangedEmail(params: { to: string }): Promise<void> {
  const html = renderLayout({
    title: "Your password was just changed",
    bodyHtml: `
      <p>This confirms the password on your Algotraders24 AI account was changed. If this was you, no action is needed.</p>
      <p>If you didn't make this change, contact us immediately at security@algotraders24.ai.</p>
    `,
    footerHtml: null,
  });

  await dispatch({ type: "password_changed", to: params.to, subject: "Your password was changed", html });
}

// AT24 Email Communication Sprint 2 (P01) - Stripe `invoice.payment_failed`
// on a subscription that is still in transient/retryable dunning (NOT the
// terminal cancellation handled by sendSubscriptionCancelledEmail, which
// fires from the separate `customer.subscription.deleted` event once Stripe
// gives up). Sent from the webhook only on the real state transition into
// "past_due" - see SubscriptionActionService.markPastDueByProvider's own
// idempotency guard for why a webhook retry or a repeated dunning attempt on
// the same still-unpaid invoice never re-sends this. No raw Stripe error
// payload, exception, or payment credential is ever included - only the
// plan, amount, and a link to the account's own existing Billing page (the
// one real place a user can update payment details or retry today; this app
// has no dedicated "retry payment" URL to link instead).
export async function sendPaymentFailedEmail(params: {
  to: string;
  buyerName: string;
  planName: string;
  amount: number;
  currency: string;
  failedAt: Date;
}): Promise<void> {
  const billingUrl = `${getSiteUrl()}/dashboard/billing`;
  const price = `${params.amount.toFixed(2)} ${params.currency}`;
  const failedOn = params.failedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const html = renderLayout({
    title: `${escapeHtml(params.buyerName)}, we couldn't process your payment`,
    bodyHtml: `
      <p>Your payment for the <strong>${escapeHtml(params.planName)}</strong> subscription didn't go through. Your access hasn't been cancelled yet - please update your payment method to keep your subscription active.</p>
      ${detailTable([
        ["Plan", escapeHtml(params.planName)],
        ["Amount due", price],
        ["Failed on", failedOn],
      ])}
    `,
    cta: { text: "Update payment method", url: billingUrl },
    footerHtml: `<p style="margin-top: 32px; font-size: 12px; color: #999;">Algotraders24 AI &middot; Can't resolve this? Contact us at support@algotraders24.ai</p>`,
  });

  await dispatch({ type: "payment_failed", to: params.to, subject: `Payment failed for your ${params.planName} subscription`, html });
}

// SP01 (AT24_EMAIL_COMMUNICATION_RECONCILIATION.md Section 11/17) - a new
// SupportHandoff ("ticket") is created (either the AI escalated, or the
// user asked for a human) and nobody on the team is told. Sent to the ops
// inbox, not the requester - the requester already sees their own widget
// switch into "handed to support" mode, so this alert exists purely to get
// a human looking at the queue.
export async function sendSupportTicketOpenedAlert(params: {
  handoffId: string;
  userEmail: string;
  triggerSource: "AI_ESCALATION" | "USER_REQUEST";
  reason: string;
}): Promise<void> {
  const queueUrl = `${getSiteUrl()}/admin/support-handoffs/${params.handoffId}`;
  const source = params.triggerSource === "AI_ESCALATION" ? "the AI Assistant escalated this" : "the user asked for a human";

  const html = renderLayout({
    title: "A new support ticket needs attention",
    maxWidth: 560,
    bodyHtml: `
      <p>A support conversation was just handed off to the team - ${source}.</p>
      ${detailTable([
        ["User", escapeHtml(params.userEmail)],
        ["Reason", escapeHtml(params.reason)],
        ["Ticket ID", `<span style="font-family: monospace; font-size: 12px;">${escapeHtml(params.handoffId)}</span>`],
      ])}
    `,
    cta: { text: "Open ticket", url: queueUrl },
    footerHtml: "",
  });

  await dispatch({ type: "support_ticket_opened_alert", to: OPS_ALERT_ADDRESS, subject: "New support ticket needs attention", html, dedupeKey: params.handoffId });
}

// SP02 - the human-reply capability the reconciliation doc found entirely
// missing. A user who filed a ticket and closed the tab has no way to know
// support wrote back other than polling the widget - this closes that gap.
export async function sendSupportReplyEmail(params: { to: string; handoffId: string }): Promise<void> {
  const conversationUrl = `${getSiteUrl()}/dashboard/support?handoff=${params.handoffId}`;

  const html = renderLayout({
    title: "Support replied to your ticket",
    bodyHtml: `<p>Someone from the Algotraders24 AI team just replied to your support conversation.</p>`,
    cta: { text: "View reply", url: conversationUrl },
  });

  await dispatch({ type: "support_reply", to: params.to, subject: "Support replied to your ticket", html });
}

// SP03 - the resolution transition already exists (transitionSupportHandoffAsAdmin
// to RESOLVED); nothing told the user their ticket was closed.
export async function sendSupportTicketResolvedEmail(params: { to: string; handoffId: string }): Promise<void> {
  const conversationUrl = `${getSiteUrl()}/dashboard/support?handoff=${params.handoffId}`;

  const html = renderLayout({
    title: "Your support ticket has been resolved",
    bodyHtml: `<p>Your support ticket has been marked resolved. If this didn't actually fix things, you can reopen it from your dashboard at any time.</p>`,
    cta: { text: "View ticket", url: conversationUrl },
  });

  await dispatch({ type: "support_ticket_resolved", to: params.to, subject: "Your support ticket has been resolved", html });
}

// B05 (AT24_EMAIL_COMMUNICATION_RECONCILIATION.md Section 18) - nothing
// previously read Subscription.currentPeriodEnd for a reminder purpose.
// Called from RenewalReminderService's daily cron sweep, which owns the
// dedupe (EmailLog keyed on subscriptionId + the exact periodEnd being
// reminded about) - this function itself has no idempotency of its own.
export async function sendRenewalReminderEmail(params: {
  to: string;
  buyerName: string;
  planName: string;
  amount: number;
  currency: string;
  periodEnd: Date;
  /** subscriptionId:periodEnd - the caller's own dedupe key, persisted onto
   *  the EmailLog row so the DB-level unique constraint backstops
   *  RenewalReminderService's own pre-send wasEmailAlreadySent check. */
  dedupeKey: string;
}): Promise<void> {
  const billingUrl = `${getSiteUrl()}/dashboard/billing`;
  const price = `${params.amount.toFixed(2)} ${params.currency}`;
  const renewsOn = params.periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const html = renderLayout({
    title: `${escapeHtml(params.buyerName)}, your ${escapeHtml(params.planName)} plan renews soon`,
    bodyHtml: `
      <p>Your subscription will automatically renew in a few days. No action is needed if you want to keep your plan.</p>
      ${detailTable([
        ["Plan", escapeHtml(params.planName)],
        ["Amount", price],
        ["Renews on", renewsOn],
      ])}
    `,
    cta: { text: "Manage subscription", url: billingUrl },
  });

  await dispatch({ type: "renewal_reminder", to: params.to, subject: `Your ${params.planName} plan renews soon`, html, dedupeKey: params.dedupeKey });
}

// Email audit follow-up (2026-09-24) - the A9 credit ledger has been live
// in production since 2026-09-07 (services/agent-framework/credits/credit-
// ledger.ts), computing a real, correct per-user balance on every real
// agent-run charge - it was simply never surfaced anywhere, dashboard or
// email. wasEmailAlreadySent's own doc comment already anticipated this
// ("credits thresholds") - this is that, finally wired. Both functions are
// called from CreditThresholdNotifier (services/agent-framework/credits/
// threshold-notifier.ts), never called directly from a route.
export async function sendCreditsLowEmail(params: {
  to: string;
  balance: number;
  allowance: number;
  planId: string;
  periodEnd: Date;
  dedupeKey: string;
}): Promise<void> {
  const billingUrl = `${getSiteUrl()}/dashboard/billing`;
  const renewsOn = params.periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const html = renderLayout({
    title: "You're running low on AI credits",
    titleColor: "#b45309",
    bodyHtml: `
      <p>You've used most of this period's AI credits. AI-powered actions (AI Agents, Automation runs) may start failing with "insufficient credits" once your balance reaches zero.</p>
      ${detailTable([
        ["Remaining", `${Math.max(0, Math.round(params.balance)).toLocaleString()} credits`],
        ["Plan allowance", `${params.allowance.toLocaleString()} credits / period`],
        ["Resets on", renewsOn],
      ])}
      <p style="color: #666; font-size: 13px;">Upgrading your plan increases your allowance immediately - it doesn't wait for the next period.</p>
    `,
    cta: { text: "View plans", url: billingUrl },
  });

  await dispatch({ type: "credits_low", to: params.to, subject: "You're running low on AI credits", html, dedupeKey: params.dedupeKey });
}

export async function sendCreditsExhaustedEmail(params: {
  to: string;
  allowance: number;
  planId: string;
  periodEnd: Date;
  dedupeKey: string;
}): Promise<void> {
  const billingUrl = `${getSiteUrl()}/dashboard/billing`;
  const renewsOn = params.periodEnd.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const html = renderLayout({
    title: "You've used all your AI credits for this period",
    titleColor: "#b91c1c",
    bodyHtml: `
      <p>AI-powered actions (AI Agents, Automation runs) will be blocked with "insufficient credits" until your allowance resets or you upgrade.</p>
      ${detailTable([
        ["Plan allowance", `${params.allowance.toLocaleString()} credits / period`],
        ["Resets on", renewsOn],
      ])}
    `,
    cta: { text: "Upgrade plan", url: billingUrl },
  });

  await dispatch({ type: "credits_exhausted", to: params.to, subject: "You've used all your AI credits for this period", html, dedupeKey: params.dedupeKey });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
