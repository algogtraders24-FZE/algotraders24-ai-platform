// services/announcements/render.ts
// Pure functions (no I/O): turn an announcement draft into the branded HTML + plain-text email. The body is written as simple text in
// the admin box: blank line = new paragraph, "- " = bullet, **word** = bold. Everything is HTML-escaped first, so nothing typed there
// can inject markup.

import { COMPANY_FOOTER_LINE } from "@/lib/company";

export interface AnnouncementContent {
  subject: string;
  preheader?: string | null;
  bodyText: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

export const SUPPORT_ADDRESS = "support@algotraders24.ai";
export const RISK_LINE = "Trading leveraged products is risky. Past results do not predict future results. Nothing here is financial advice.";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const inline = (escaped: string): string => escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

type Block = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

export function parseBody(bodyText: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of bodyText.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      blocks.push({ kind: "ul", items: lines.map((l) => l.replace(/^\s*-\s+/, "")) });
    } else {
      blocks.push({ kind: "p", text: lines.join("\n") });
    }
  }
  return blocks;
}

/** CTA links must be https and on the platform's own domain family, so an announcement can never point users somewhere else. */
export function isAllowedCtaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "algotraders24.ai" || u.hostname.endsWith(".algotraders24.ai"));
  } catch {
    return false;
  }
}

export function renderAnnouncementEmail(c: AnnouncementContent, unsubscribeUrl: string): { html: string; text: string } {
  const GOLD = "#d4af37";
  const blocks = parseBody(c.bodyText);
  const bodyHtml = blocks
    .map((b) =>
      b.kind === "p"
        ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#2a2a2e;">${inline(escapeHtml(b.text)).replace(/\n/g, "<br>")}</p>`
        : `<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.65;color:#2a2a2e;">${b.items.map((i) => `<li style="margin-bottom:6px;">${inline(escapeHtml(i))}</li>`).join("")}</ul>`,
    )
    .join("");
  const hasCta = !!(c.ctaLabel && c.ctaUrl && isAllowedCtaUrl(c.ctaUrl));
  const cta = hasCta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px;"><tr><td style="background:${GOLD};border-radius:8px;"><a href="${escapeHtml(c.ctaUrl!)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#14110a;text-decoration:none;">${escapeHtml(c.ctaLabel!)}</a></td></tr></table>`
    : "";
  const pre = c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(c.preheader)}</div>` : "";

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f1ee;">
${pre}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f1ee;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b0b10;border-radius:14px 14px 0 0;padding:22px 28px;">
      <div style="font-size:12px;letter-spacing:3px;font-weight:700;color:${GOLD};">ALGOTRADERS24 AI</div>
      <div style="font-size:12px;color:#9a8f73;margin-top:4px;">AI market research &middot; trading marketplace</div>
    </td></tr>
    <tr><td style="height:3px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:30px 28px 24px;">
      <h1 style="margin:0 0 18px;font-size:23px;line-height:1.3;color:#14110a;">${escapeHtml(c.subject)}</h1>
      ${bodyHtml}
      ${cta}
    </td></tr>
    <tr><td style="background:#ffffff;padding:0 28px 24px;">
      <div style="border-top:1px solid #e7e4dc;padding-top:16px;font-size:13px;line-height:1.6;color:#5c5a54;">Questions? Just reply to this email &mdash; it reaches our support team (${SUPPORT_ADDRESS}).</div>
    </td></tr>
    <tr><td style="background:#faf9f6;border-radius:0 0 14px 14px;padding:18px 28px;font-size:12px;line-height:1.6;color:#8a877e;">
      <div>${escapeHtml(RISK_LINE)}</div>
      <div style="margin-top:10px;">${escapeHtml(COMPANY_FOOTER_LINE)}</div>
      <div style="margin-top:10px;">You receive product updates because you have an Algotraders24 AI account. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a877e;text-decoration:underline;">Unsubscribe from product updates</a>.</div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const textBody = blocks.map((b) => (b.kind === "p" ? b.text.replace(/\*\*(.+?)\*\*/g, "$1") : b.items.map((i) => `- ${i.replace(/\*\*(.+?)\*\*/g, "$1")}`).join("\n"))).join("\n\n");
  const text = [
    c.subject,
    "",
    textBody,
    hasCta ? `\n${c.ctaLabel}: ${c.ctaUrl}` : "",
    "",
    `Questions? Reply to this email (${SUPPORT_ADDRESS}).`,
    "",
    RISK_LINE,
    COMPANY_FOOTER_LINE,
    `Unsubscribe from product updates: ${unsubscribeUrl}`,
  ]
    .filter((x, i, a) => !(x === "" && a[i - 1] === ""))
    .join("\n");

  return { html, text };
}
