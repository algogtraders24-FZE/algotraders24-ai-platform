// lib/rewards/emailContent.ts
// (Pure - builds strings.) The body of the "your Algo Contract is ready" email. The outer layout, footer and sending live in
// services/notifications/EmailService.ts; this only produces the subject and the inner HTML, so it can be tested without Resend.
import { GUIDE_PATH, QUICK_START } from "./guide";
import { formatUsd } from "./money";

export interface ContractEmailInput {
  name: string;
  productName: string;
  contractId: string;
  listPriceCents: number;
  rebateTotalCents: number;
  netPriceCents: number;
  schedule: Array<{ seq: number; dueAt: Date; amountCents: number }>;
  startsAt: Date;
  endsAt: Date;
  siteUrl: string;
  /** True when the PDF is attached to this email. */
  pdfAttached: boolean;
}

export function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const day = (d: Date) => d.toISOString().slice(0, 10);

const row = (label: string, value: string) =>
  `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right;">${value}</td></tr>`;

export function contractEmailSubject(productName: string): string {
  return `Your Algo Contract is ready: ${productName}`;
}

export function contractEmailBody(i: ContractEmailInput): string {
  const guideUrl = `${i.siteUrl.replace(/\/+$/, "")}${GUIDE_PATH}`;
  const summary = [
    row("Product", escapeHtmlText(i.productName)),
    row("Contract", `<span style="font-family: monospace; font-size: 12px;">${escapeHtmlText(i.contractId)}</span>`),
    row("Term", `${day(i.startsAt)} to ${day(i.endsAt)} (12 months)`),
    row("Price", formatUsd(i.listPriceCents)),
    row("Total rebate", formatUsd(i.rebateTotalCents)),
    row("<strong>Net price</strong>", `<strong>${formatUsd(i.netPriceCents)}</strong>`),
  ].join("");
  const schedule = i.schedule.map((s) => row(`Rebate ${s.seq} &middot; due ${day(s.dueAt)}`, formatUsd(s.amountCents))).join("");
  const steps = QUICK_START.map((s) => `<li style="margin-bottom: 6px;">${escapeHtmlText(s)}</li>`).join("");
  return `
    <p>Hi ${escapeHtmlText(i.name)}, your payment is confirmed and your 12-month contract for <strong>${escapeHtmlText(i.productName)}</strong> is active.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">${summary}</table>
    <h2 style="font-size: 16px; margin: 24px 0 4px;">Your rebate schedule</h2>
    <p style="margin: 0 0 4px; color: #666; font-size: 13px;">A fixed adjustment to the price you paid. Each instalment is credited on its due date while your Pro plan is active and your identity is verified; otherwise it is paused and kept for you.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 8px 0 16px;">${schedule}</table>
    <h2 style="font-size: 16px; margin: 24px 0 4px;">Get started</h2>
    <ol style="padding-left: 20px; margin: 8px 0 16px;">${steps}</ol>
    <p>${i.pdfAttached ? "Your contract (PDF) is attached to this email. " : ""}You can always download it again from Algo Contracts in your dashboard.</p>
    <p>Full guide, including withdrawals and your referral link: <a href="${guideUrl}">${guideUrl}</a></p>
    <p style="font-size: 12px; color: #666;">The product is software and we make no promise about trading results. Trading involves a risk of loss. Sales are final once your licence is issued, except as set out in our refund policy.</p>
  `;
}
