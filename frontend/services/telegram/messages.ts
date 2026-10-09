// services/telegram/messages.ts
// AT24 Telegram: every message text, pure. Everything user-controlled (titles, page names, account labels) is HTML-escaped.
// Messages never carry money amounts of other people, never a trading instruction, and the channel texts make no
// performance promise. Personal alerts only inform; nothing here trades.

import { escapeHtml } from "./client";

const hr = (siteUrl: string, path: string, label: string) => `<a href="${escapeHtml(siteUrl + path)}">${escapeHtml(label)}</a>`;

export function alertMessage(p: { title: string; body: string; href?: string; siteUrl: string }): string {
  return `<b>${escapeHtml(p.title)}</b>\n${escapeHtml(p.body)}\n\n${hr(p.siteUrl, p.href ?? "/dashboard/live-sync", "Open AT24")}\n<i>An information alert from AT24. AT24 never trades or closes positions for you.</i>`;
}

export function testMessage(siteUrl: string): string {
  return `<b>AT24 test message</b>\nTelegram is connected. Your Live Sync alerts and watch notices will arrive in this chat.\n\n${hr(siteUrl, "/dashboard/live-sync", "Manage alerts")}`;
}

export function linkedMessage(): string {
  return "<b>Connected to AT24</b>\nYou will now get your Live Sync alerts here (margin level, daily loss, drawdown, EA offline, no stop loss) and notices about the Live Results pages you watch.\n\n/status shows what is on, /stop disconnects.";
}

export function helpMessage(siteUrl: string): string {
  return `This is the AT24 alert bot. To connect it, open ${hr(siteUrl, "/dashboard/live-sync", "AT24 > Live Sync")} and press <b>Connect Telegram</b>.\n\nCommands: /status, /stop`;
}

export function expiredCodeMessage(siteUrl: string): string {
  return `That connect link expired or was already used. Open ${hr(siteUrl, "/dashboard/live-sync", "AT24 > Live Sync")} and press <b>Connect Telegram</b> again to get a new one.`;
}

export function statusMessage(link: { alertsOn: boolean; watchOn: boolean } | null): string {
  if (!link) return "This chat is not connected to an AT24 account. Open AT24 > Live Sync and press Connect Telegram.";
  return `<b>Connected</b>\nLive Sync alerts: ${link.alertsOn ? "on" : "off"}\nWatch notices: ${link.watchOn ? "on" : "off"}\n\nChange this on AT24 > Live Sync, or /stop to disconnect.`;
}

export function stoppedMessage(wasLinked: boolean): string {
  return wasLinked ? "Disconnected. You will not get AT24 alerts here any more. You can connect again from AT24 > Live Sync." : "This chat was not connected.";
}

export interface ListingNote {
  title: string;
  slug: string;
  priceText: string | null;
  platform: string;
  asset: string;
}

/** A neutral "new on the marketplace" line. No performance claim of any kind. */
export function listingAnnouncement(l: ListingNote, siteUrl: string): string {
  const facts = [l.platform, l.asset, l.priceText].filter((x): x is string => typeof x === "string" && x.trim().length > 0).map(escapeHtml).join(" · ");
  return `<b>New on AT24 Marketplace</b>\n${escapeHtml(l.title)}${facts ? `\n${facts}` : ""}\n\n${hr(siteUrl, `/marketplace/${l.slug}`, "See the listing, its evidence and its limits")}\n<i>Past results do not predict future results. Not investment advice.</i>`;
}

export interface DigestRow {
  title: string;
  slug: string;
  trades: number;
  gainPct: number | null;
  maxDrawdownPct: number | null;
  monthlyPct: number | null;
}

const pct = (n: number | null) => (n === null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

/** Weekly digest of PUBLIC Live Results pages: percent only, drawdown always next to the gain, no ranking, a disclaimer. */
export function digestMessage(rows: readonly DigestRow[], siteUrl: string, weekLabel: string): string {
  const lines = rows.slice(0, 8).map((r) => `• ${hr(siteUrl, `/results/${r.slug}`, r.title)}: gain ${pct(r.gainPct)}, max drawdown ${r.maxDrawdownPct === null ? "-" : `${r.maxDrawdownPct.toFixed(2)}%`}, this month ${pct(r.monthlyPct)}, ${r.trades} trades`);
  return `<b>AT24 Live Results, ${escapeHtml(weekLabel)}</b>\nPublic pages with at least 30 closed trades, in no particular order:\n${lines.join("\n")}\n\n<i>Terminal-reported by each owner's own MetaTrader terminal, NOT independently verified. Past results do not predict future results. Not investment advice.</i>`;
}

export function priceText(pricing: unknown): string | null {
  if (typeof pricing !== "object" || pricing === null) return null;
  const p = pricing as { amount?: unknown; currency?: unknown; model?: unknown };
  if (typeof p.amount !== "number" || !Number.isFinite(p.amount)) return null;
  if (p.amount === 0) return "Free";
  const cur = typeof p.currency === "string" && p.currency.length <= 4 ? p.currency : "USD";
  return `${p.amount % 1 === 0 ? p.amount.toFixed(0) : p.amount.toFixed(2)} ${cur}${p.model === "subscription" ? "/month" : ""}`;
}
