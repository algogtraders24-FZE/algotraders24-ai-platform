// lib/rewards/kycEmail.ts
// (Pure - builds strings.) The "please verify your identity" email for members who already hold a paid plan. Outer layout and sending
// live in services/notifications/EmailService.ts. It must stay true: the current plan is NOT cancelled, the rule applies to the next
// purchase or renewal, and AT24 never sees the ID document (the verification partner keeps it).
import { escapeHtmlText } from "./emailContent";

export const KYC_EMAIL_SUBJECT = "Please verify your identity (takes a few minutes)";

export function kycEmailBody(i: { name: string; siteUrl: string }): string {
  const settings = `${i.siteUrl.replace(/\/+$/, "")}/dashboard/settings`;
  return `
    <p>Hi ${escapeHtmlText(i.name)},</p>
    <p>We are adding an identity check (KYC) for paid plans. From now on, <strong>buying or renewing a paid plan</strong>, and joining <strong>Algo Contracts</strong> (AI Algo contracts with a fixed rebate credited every 3 months), needs a verified identity.</p>
    <p><strong>Your current plan keeps working until it ends.</strong> Nothing is cancelled today. Verifying now just means your next renewal, and Algo Contracts, are not interrupted.</p>
    <h2 style="font-size: 16px; margin: 20px 0 4px;">How to verify</h2>
    <ol style="padding-left: 20px; margin: 8px 0 16px;">
      <li style="margin-bottom: 6px;">Open Settings in your dashboard and find <em>Identity verification (KYC)</em>.</li>
      <li style="margin-bottom: 6px;">Press <em>Verify identity</em> and follow the steps: a photo of an ID document and a selfie.</li>
      <li style="margin-bottom: 6px;">You usually get the result within a few minutes. Refresh the page afterwards.</li>
    </ol>
    <p style="font-size: 13px; color: #666;">The check is done by our verification partner. AT24 never sees or stores your ID document, only the result (verified or not). If you have not confirmed your email address yet, do that first.</p>
    <p style="font-size: 13px;">Settings: <a href="${settings}">${settings}</a></p>
  `;
}
