// Validates AT24 Telegram (personal alerts + AT24's own channel): config, messages, link codes, webhook, delivery, client, channel. No network, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { telegramConfig } from "../services/telegram/config";
import { createTelegramClient, escapeHtml, MAX_MESSAGE_CHARS, type FetchLike, type SendResult, type TelegramClient } from "../services/telegram/client";
import { alertMessage, digestMessage, helpMessage, linkedMessage, listingAnnouncement, priceText, statusMessage, testMessage } from "../services/telegram/messages";
import { hashCode, newLinkCode, parseStartPayload, secretMatches, type LinkRow, type TelegramStore } from "../services/telegram/store";
import { handleTelegramUpdate } from "../services/telegram/webhook";
import { sendTelegramToUser } from "../services/telegram/deliver";
import { announceNewListings, isoWeekKey, postWeeklyDigest, type AnnounceListing, type ChannelDeps } from "../services/telegram/channel";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const SITE = "https://www.algotraders24.ai";
const TOKEN = "123456789:AAH_fake_token_for_tests_only_0123456789";

// ---------------------------------------------------------------- fakes
function fakeStore(now = () => new Date()): TelegramStore & { links: Map<string, LinkRow>; codes: Map<string, { userId: string; expiresAt: Date }>; posts: Set<string> } {
  const links = new Map<string, LinkRow>();
  const codes = new Map<string, { userId: string; expiresAt: Date }>();
  const posts = new Set<string>();
  return {
    links, codes, posts,
    async createCode(userId, hash, expiresAt) { codes.set(hash, { userId, expiresAt }); },
    async consumeCode(hash, at) { const c = codes.get(hash); if (!c || c.expiresAt.getTime() <= at.getTime()) return null; codes.delete(hash); return c.userId; },
    async link(userId, chatId, username) { for (const [u, l] of links) if (u === userId || l.chatId === chatId) links.delete(u); links.set(userId, { userId, chatId, username, alertsOn: true, watchOn: true, linkedAt: now() }); },
    async getByUser(userId) { return links.get(userId) ?? null; },
    async getByChat(chatId) { return [...links.values()].find((l) => l.chatId === chatId) ?? null; },
    async unlinkByUser(userId) { return links.delete(userId); },
    async unlinkByChat(chatId) { const l = [...links.values()].find((x) => x.chatId === chatId); return l ? links.delete(l.userId) : false; },
    async setPrefs(userId, p) { const l = links.get(userId); if (!l) return false; links.set(userId, { ...l, ...p }); return true; },
    async touchSent() { /* not needed */ },
    async hasPosted(kind, refId) { return posts.has(`${kind}:${refId}`); },
    async recordPost(kind, refId) { posts.add(`${kind}:${refId}`); },
  };
}
function fakeClient(result: Partial<SendResult> = {}): TelegramClient & { sent: { chatId: string; text: string }[] } {
  const sent: { chatId: string; text: string }[] = [];
  return { sent, async sendMessage(chatId, text) { sent.push({ chatId, text }); return { ok: true, status: 200, gone: false, messageId: String(sent.length), ...result }; } };
}
const upd = (text: string, o: { type?: string; id?: number; bot?: boolean; username?: string } = {}) => ({ update_id: 1, message: { text, chat: { id: o.id ?? 555, type: o.type ?? "private" }, from: { id: o.id ?? 555, is_bot: o.bot ?? false, username: o.username ?? "trader_1" } } });

async function main(): Promise<void> {
  // ------------------------------------------------------------ config
  eq(telegramConfig({}).enabled, false, "nothing configured = disabled");
  eq(telegramConfig({ TELEGRAM_ENABLED: "true" }).enabled, false, "enabled flag without a token = disabled");
  eq(telegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN }).enabled, false, "a token without the enabled flag = disabled");
  eq(telegramConfig({ TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: TOKEN }).enabled, true, "flag + token = enabled");
  eq(telegramConfig({ TELEGRAM_BOT_USERNAME: "@AT24_Bot" }).botUsername, "AT24_Bot", "the leading @ is removed from the bot username");
  eq([telegramConfig({}).announce, telegramConfig({ TELEGRAM_CHANNEL_ANNOUNCE: "all" }).announce, telegramConfig({ TELEGRAM_CHANNEL_ANNOUNCE: "OFF" }).announce, telegramConfig({ TELEGRAM_CHANNEL_ANNOUNCE: "x" }).announce], ["admin", "all", "off", "admin"], "announce mode defaults to AT24's own listings only; junk falls back to admin");
  eq(telegramConfig({}).digestOn, false, "the weekly digest is off by default");
  eq(telegramConfig({ TELEGRAM_CHANNEL_DIGEST: "on" }).digestOn, true, "the digest needs an explicit on");
  eq(telegramConfig({ TELEGRAM_SITE_URL: "https://x.example///" }).siteUrl, "https://x.example", "trailing slashes are removed from the site url");

  // ------------------------------------------------------------ messages are escaped
  eq(escapeHtml(`<a href="x">&</a>`), `&lt;a href="x"&gt;&amp;&lt;/a&gt;`, "html special characters are escaped");
  const evil = alertMessage({ title: "<script>alert(1)</script>", body: 'Margin <b>low</b> & "bad"', siteUrl: SITE });
  ok(!/<script|<b>low/.test(evil) && evil.includes("&lt;script&gt;"), "a hostile title/body cannot inject markup into an alert");
  ok(evil.includes('<a href="https://www.algotraders24.ai/dashboard/live-sync">'), "the alert links to AT24");
  ok(/never trades or closes positions/.test(evil), "the alert says it only informs");
  ok(testMessage(SITE).includes("test message") && linkedMessage().includes("/stop") && helpMessage(SITE).includes("Connect Telegram"), "test / linked / help messages exist");
  ok(statusMessage(null).includes("not connected") && statusMessage({ alertsOn: true, watchOn: false }).includes("Watch notices: off"), "status messages");
  const l = listingAnnouncement({ title: "Gold <Range> Breaker", slug: "gold-range", priceText: "299 USD", platform: "MT5", asset: "Gold" }, SITE);
  ok(l.includes("Gold &lt;Range&gt; Breaker") && l.includes("/marketplace/gold-range") && l.includes("299 USD"), "a listing announcement is escaped and links the listing");
  ok(!/profit|return|%|guarantee|win rate|gain/i.test(l.replace(/Past results do not predict future results\./, "")), "a listing announcement makes no performance claim");
  eq([priceText({ model: "one_time", amount: 79, currency: "USD" }), priceText({ amount: 0 }), priceText({ model: "subscription", amount: 9.5, currency: "USD" }), priceText(null), priceText({ amount: "x" })], ["79 USD", "Free", "9.50 USD/month", null, null], "price text");
  const dg = digestMessage([{ title: "XXXUS30", slug: "xxxus30", trades: 800, gainPct: 248.13, maxDrawdownPct: 61.91, monthlyPct: 20.2 }, { title: "B <b>", slug: "b", trades: 40, gainPct: null, maxDrawdownPct: null, monthlyPct: null }], SITE, "2026-W41");
  ok(dg.includes("max drawdown 61.91%") && dg.includes("NOT independently verified") && dg.includes("no particular order"), "the digest shows drawdown next to gain, says not verified and never ranks");
  ok(!/USD|\$/.test(dg) && !dg.includes("<b>B"), "the digest is percent-only and escaped");

  // ------------------------------------------------------------ link codes
  const c = newLinkCode();
  ok(/^[0-9a-f]{32}$/.test(c.code) && c.hash === hashCode(c.code) && c.hash !== c.code && c.hash.length === 64, "a code is 128 random bits; only its SHA-256 is stored");
  ok(newLinkCode().code !== c.code, "codes differ");
  eq([parseStartPayload(`/start ${c.code}`), parseStartPayload(`/start@AT24_bot ${c.code}`), parseStartPayload("/start"), parseStartPayload("/start abc"), parseStartPayload(`/start ${c.code}; DROP`), parseStartPayload("/stop")], [c.code, c.code, null, null, null, null], "only a well-formed 32-hex payload is accepted");
  eq([secretMatches("abc", "abc"), secretMatches("abd", "abc"), secretMatches("abcd", "abc"), secretMatches(null, "abc"), secretMatches("abc", ""), secretMatches("", "")], [true, false, false, false, false, false], "the webhook secret is compared exactly; an empty secret never matches");

  // ------------------------------------------------------------ webhook
  const mk = () => ({ store: fakeStore(), client: fakeClient(), siteUrl: SITE });
  {
    const d = mk();
    const code = newLinkCode();
    await d.store.createCode("user-1", code.hash, new Date(Date.now() + 60_000));
    eq(await handleTelegramUpdate(upd(`/start ${code.code}`, { id: 777, username: "pravin_t" }), d), "linked", "a valid code links the chat");
    eq([d.store.links.get("user-1")?.chatId, d.store.links.get("user-1")?.username], ["777", "pravin_t"], "the user is linked to that chat with the username");
    ok(d.client.sent.length === 1 && d.client.sent[0]!.text.includes("Connected to AT24"), "the user gets a confirmation");
    eq(await handleTelegramUpdate(upd(`/start ${code.code}`, { id: 888 }), d), "expired_code", "a code works once");
    ok(!d.store.links.has("someone-else") && d.store.links.size === 1, "the second use linked nothing");
  }
  {
    const d = mk();
    const code = newLinkCode();
    await d.store.createCode("user-1", code.hash, new Date(Date.now() - 1000));
    eq(await handleTelegramUpdate(upd(`/start ${code.code}`), d), "expired_code", "an expired code is refused");
    eq(d.store.links.size, 0, "nothing linked");
    ok(d.client.sent[0]!.text.includes("expired"), "the user is told to get a new link");
  }
  {
    const d = mk();
    const code = newLinkCode();
    await d.store.createCode("user-1", code.hash, new Date(Date.now() + 60_000));
    eq(await handleTelegramUpdate(upd(`/start ${code.code}`, { type: "group", id: -100123 }), d), "ignored", "a group chat can never be linked");
    eq(await handleTelegramUpdate(upd(`/start ${code.code}`, { type: "channel" }), d), "ignored", "a channel can never be linked");
    eq(await handleTelegramUpdate(upd(`/start ${code.code}`, { bot: true }), d), "ignored", "a bot sender is ignored");
    eq(await handleTelegramUpdate(upd("hello"), d), "ignored", "plain text (not a command) is ignored");
    eq(await handleTelegramUpdate({}, d), "ignored", "an update without a message is ignored");
    eq(await handleTelegramUpdate(null, d), "ignored", "null is ignored");
    eq(await handleTelegramUpdate({ message: { text: "/start", chat: { id: "x1", type: "private" } } }, d), "ignored", "a non-numeric chat id is ignored");
    eq([d.store.links.size, d.client.sent.length, d.store.codes.size], [0, 0, 1], "none of those linked, replied or used the code");
  }
  {
    const d = mk();
    eq(await handleTelegramUpdate(upd("/start"), d), "help", "/start without a code explains how to connect");
    eq(await handleTelegramUpdate(upd("/start not-a-code"), d), "help", "/start with a junk payload explains too");
    eq(await handleTelegramUpdate(upd("/whatever"), d), "help", "an unknown command shows help");
    eq(await handleTelegramUpdate(upd("/status"), d), "status", "/status");
    ok(d.client.sent.at(-1)!.text.includes("not connected"), "/status on an unlinked chat says so");
    const code = newLinkCode();
    await d.store.createCode("u2", code.hash, new Date(Date.now() + 60_000));
    await handleTelegramUpdate(upd(`/start ${code.code}`, { username: "bad name!" }), d);
    eq(d.store.links.get("u2")?.username, null, "an odd username is not stored");
    await handleTelegramUpdate(upd("/status"), d);
    ok(d.client.sent.at(-1)!.text.includes("Connected"), "/status on a linked chat");
    eq(await handleTelegramUpdate(upd("/stop"), d), "stopped", "/stop disconnects");
    eq(d.store.links.size, 0, "the link is gone");
    await handleTelegramUpdate(upd("/stop"), d);
    ok(d.client.sent.at(-1)!.text.includes("not connected"), "/stop twice is harmless");
  }
  {
    const d = mk();
    const a = newLinkCode(), b = newLinkCode();
    await d.store.createCode("A", a.hash, new Date(Date.now() + 60_000));
    await d.store.createCode("B", b.hash, new Date(Date.now() + 60_000));
    await handleTelegramUpdate(upd(`/start ${a.code}`, { id: 42 }), d);
    await handleTelegramUpdate(upd(`/start ${b.code}`, { id: 42 }), d);
    eq([d.store.links.has("A"), d.store.links.get("B")?.chatId, d.store.links.size], [false, "42", 1], "one chat belongs to one user: a chat re-linked to B is no longer A's");
  }
  {
    const throwing: TelegramClient = { async sendMessage() { throw new Error("boom"); } };
    const d = { store: fakeStore(), client: throwing, siteUrl: SITE };
    eq(await handleTelegramUpdate(upd("/status"), d), "ignored", "a failing client never throws out of the webhook handler");
  }

  // ------------------------------------------------------------ delivery to one user
  {
    const store = fakeStore();
    const client = fakeClient();
    eq(await sendTelegramToUser("u1", "alerts", "hi", { store, client, enabled: true }), false, "an unlinked user gets nothing");
    await store.link("u1", "100", "x");
    eq(await sendTelegramToUser("u1", "alerts", "hi", { store, client, enabled: true }), true, "a linked user gets the alert");
    eq(client.sent, [{ chatId: "100", text: "hi" }], "sent to the linked chat only");
    await store.setPrefs("u1", { alertsOn: false });
    eq(await sendTelegramToUser("u1", "alerts", "again", { store, client, enabled: true }), false, "alerts switched off = nothing");
    eq(await sendTelegramToUser("u1", "watch", "w", { store, client, enabled: true }), true, "watch notices have their own switch");
    await store.setPrefs("u1", { watchOn: false });
    eq(await sendTelegramToUser("u1", "watch", "w2", { store, client, enabled: true }), false, "watch switched off = nothing");
    eq(client.sent.length, 2, "exactly the two accepted sends reached Telegram");
    eq(await sendTelegramToUser("u1", "alerts", "x", { store, client, enabled: false }), false, "disabled (no bot configured) = nothing and no store access");
    const blocked = fakeClient({ ok: false, status: 403, gone: true });
    await store.setPrefs("u1", { alertsOn: true });
    eq(await sendTelegramToUser("u1", "alerts", "x", { store, client: blocked, enabled: true }), false, "a blocked bot fails");
    eq(await store.getByUser("u1"), null, "and the dead link is removed");
    const boom: TelegramClient = { async sendMessage() { throw new Error("net"); } };
    await store.link("u1", "100", null);
    eq(await sendTelegramToUser("u1", "alerts", "x", { store, client: boom, enabled: true }), false, "a client that throws never throws out of the alert path");
    ok((await store.getByUser("u1")) !== null, "a temporary failure keeps the link");
  }

  // ------------------------------------------------------------ the Telegram client
  {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = (status: number, body: unknown): FetchLike => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> }); return { status, async json() { return body; } }; };
    const okRes = await createTelegramClient(TOKEN, f(200, { ok: true, result: { message_id: 77 } })).sendMessage("1", "hello");
    eq([okRes.ok, okRes.messageId, okRes.gone], [true, "77", false], "a successful send returns the message id");
    ok(calls[0]!.url === `https://api.telegram.org/bot${TOKEN}/sendMessage` && calls[0]!.body.parse_mode === "HTML" && calls[0]!.body.disable_web_page_preview === true, "HTML mode, no link previews");
    ok(!JSON.stringify(calls[0]!.body).includes(TOKEN), "the token is only in the URL, never in the body");
    await createTelegramClient(TOKEN, f(200, { ok: true, result: {} })).sendMessage("1", "x".repeat(10_000));
    eq((calls[1]!.body.text as string).length, MAX_MESSAGE_CHARS, "a long text is cut to the message cap");
    const blocked = await createTelegramClient(TOKEN, f(403, { ok: false, description: "Forbidden: bot was blocked by the user" })).sendMessage("1", "x");
    eq([blocked.ok, blocked.gone], [false, true], "403 / blocked = gone");
    const nochat = await createTelegramClient(TOKEN, f(400, { ok: false, description: "Bad Request: chat not found" })).sendMessage("1", "x");
    eq(nochat.gone, true, "chat not found = gone");
    const bad = await createTelegramClient(TOKEN, f(400, { ok: false, description: "Bad Request: can't parse entities" })).sendMessage("1", "x");
    eq([bad.ok, bad.gone], [false, false], "another 400 is a failure but not a gone chat");
    const limited = await createTelegramClient(TOKEN, f(429, { ok: false, description: "Too Many Requests", parameters: { retry_after: 7 } })).sendMessage("1", "x");
    eq([limited.ok, limited.retryAfter, limited.gone], [false, 7, false], "429 carries retry_after");
    const net = await createTelegramClient(TOKEN, async () => { throw new Error("down"); }).sendMessage("1", "x");
    eq([net.ok, net.status, net.gone], [false, 0, false], "a network error is a failure, not a throw");
  }

  // ------------------------------------------------------------ AT24's own channel
  const listing = (id: string, sellerIsAdmin: boolean): AnnounceListing => ({ id, slug: `slug-${id}`, title: `Listing ${id}`, pricing: { amount: 79, currency: "USD", model: "one_time" }, platformTag: "MT5", assetTag: "Gold", sellerIsAdmin });
  const chan = (over: Partial<ChannelDeps> & { listings?: AnnounceListing[] }): { deps: ChannelDeps; store: ReturnType<typeof fakeStore>; client: ReturnType<typeof fakeClient> } => {
    const store = fakeStore();
    const client = fakeClient();
    return {
      store, client,
      deps: { store, client, channelId: "@at24updates", siteUrl: SITE, announce: "admin", digestOn: false, recentListings: async () => over.listings ?? [], digestRows: async () => [], ...over },
    };
  };
  {
    const { deps, client, store } = chan({ listings: [listing("a", true), listing("b", false), listing("c", true)] });
    eq(await announceNewListings(deps), { posted: 2, skipped: 1 }, "default mode announces only AT24's own listings");
    ok(client.sent.every((s) => s.chatId === "@at24updates") && client.sent[0]!.text.includes("slug-a") && !client.sent.some((s) => s.text.includes("slug-b")), "posted to the channel; the seller's listing is not announced");
    eq(await announceNewListings(deps), { posted: 0, skipped: 1 }, "running again announces nothing twice");
    ok(store.posts.has("listing:a") && store.posts.has("listing:c"), "each announcement is recorded");
  }
  {
    const { deps } = chan({ announce: "all", listings: [listing("a", false)] });
    eq((await announceNewListings(deps)).posted, 1, "mode all announces seller listings too");
  }
  eq(await announceNewListings(chan({ announce: "off", listings: [listing("a", true)] }).deps), { posted: 0, skipped: 0 }, "mode off posts nothing");
  eq(await announceNewListings(chan({ channelId: "", listings: [listing("a", true)] }).deps), { posted: 0, skipped: 0 }, "no channel id = dormant");
  eq((await announceNewListings(chan({ listings: [1, 2, 3, 4, 5].map((n) => listing(String(n), true)) }).deps)).posted, 3, "at most 3 posts per run (no flood)");
  {
    const { deps, store } = chan({ listings: [listing("a", true), listing("b", true)] });
    const failing = fakeClient({ ok: false, status: 500, gone: false });
    eq((await announceNewListings({ ...deps, client: failing })).posted, 0, "a failing channel posts nothing");
    eq(failing.sent.length, 1, "and stops after the first failure instead of hammering");
    eq(store.posts.size, 0, "a failed post is not recorded, so the next run retries it");
  }
  // weekly digest
  const row = (n: number, enough: boolean) => ({ title: `P${n}`, slug: `p${n}`, trades: enough ? 100 : 5, gainPct: 10, maxDrawdownPct: 4, monthlyPct: 2, enoughData: enough });
  eq(await postWeeklyDigest(chan({ digestOn: false, listings: [], digestRows: async () => [row(1, true)] }).deps), false, "digest off (the default) posts nothing");
  {
    const { deps, client } = chan({ digestOn: true, digestRows: async () => [row(1, true), row(2, false)], now: () => new Date("2026-10-09T10:00:00Z") });
    eq(await postWeeklyDigest(deps), true, "digest on posts once");
    ok(client.sent[0]!.text.includes("P1") && !client.sent[0]!.text.includes("P2"), "only pages with enough trades are in it");
    eq(await postWeeklyDigest(deps), false, "not twice in the same week");
    eq(await postWeeklyDigest({ ...deps, now: () => new Date("2026-10-16T10:00:00Z") }), true, "again the next week");
  }
  eq(await postWeeklyDigest(chan({ digestOn: true, digestRows: async () => [row(1, false)] }).deps), false, "no page with enough trades = no digest");
  eq([isoWeekKey(new Date("2026-01-01T00:00:00Z")), isoWeekKey(new Date("2025-12-29T12:00:00Z")), isoWeekKey(new Date("2026-12-31T12:00:00Z")), isoWeekKey(new Date("2026-10-09T10:00:00Z"))], ["2026-W01", "2026-W01", "2026-W53", "2026-W41"], "ISO week keys, including the year boundaries");

  // ------------------------------------------------------------ files
  const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20261011130000_add_telegram", "migration.sql"), "utf8");
  eq([...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1]), ["telegram_links", "telegram_link_codes", "telegram_channel_posts"], "the migration creates exactly the three Telegram tables");
  ok(!/\bDROP\b|\bALTER TABLE\b|\bDELETE\b|\bUPDATE\b/i.test(sql), "the migration only adds: no drop, alter, delete or update");
  const hook = readFileSync(join(__dirname, "..", "app", "api", "telegram", "webhook", "route.ts"), "utf8");
  ok(/secretMatches\(request\.headers\.get\("x-telegram-bot-api-secret-token"\), cfg\.webhookSecret\)/.test(hook) && hook.indexOf("secretMatches(request") < hook.indexOf("await handleTelegramUpdate("), "the webhook checks the secret header before it looks at the update");
  const store = readFileSync(join(__dirname, "..", "services", "telegram", "store.ts"), "utf8");
  ok(!/codeHash:\s*code\b/.test(store) && /createCode\(userId, codeHash, expiresAt\)/.test(store), "the raw code is never stored");

  console.log(`validate-telegram: ${checks} checks passed`);
}

void main();
