// Validates the installable app + Web Push: manifest, icons, service worker, subscription safety (SSRF guard), payload, delivery, config.
// No network, no database. Run: npx tsx scripts/validate-pwa.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import manifest from "../app/manifest";
import { pushConfig } from "../services/push/config";
import { buildPayload, isAllowedPushEndpoint, MAX_SUBSCRIPTIONS_PER_USER, parseSubscription, safeNotificationPath } from "../services/push/subscription";
import { sendPushToUser, type PushSender } from "../services/push/deliver";
import { MAX_FAILURES, type PushStore, type SubRow } from "../services/push/store";
import { detectPlatform, installBannerHidden, installHint, INSTALL_DISMISS_DAYS, pushNeedsHomeScreen, urlBase64ToUint8Array } from "../lib/pwa/helpers";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const ROOT = join(__dirname, "..");

const P256 = "B".repeat(87);
const AUTH = "a".repeat(22);
const FCM = "https://fcm.googleapis.com/fcm/send/abcDEF123-xyz:APA91bExample0123456789";

// ---------------------------------------------------------------- fake store
function fakeStore(initial: Partial<SubRow>[] = []): PushStore & { rows: Map<string, SubRow>; sentIds: string[] } {
  const rows = new Map<string, SubRow>();
  const sentIds: string[] = [];
  let n = 0;
  const add = (r: Partial<SubRow>) => { const id = r.id ?? `s${++n}`; rows.set(id, { id, userId: "u1", endpoint: `${FCM}${id}`, p256dh: P256, auth: AUTH, alertsOn: true, watchOn: true, failures: 0, createdAt: new Date(2026, 9, n), ...r }); };
  initial.forEach(add);
  return {
    rows, sentIds,
    async upsert(userId, sub) { const ex = [...rows.values()].find((r) => r.endpoint === sub.endpoint); if (ex) { ex.userId = userId; ex.failures = 0; } else add({ userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }); const mine = [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); mine.slice(MAX_SUBSCRIPTIONS_PER_USER).forEach((r) => rows.delete(r.id)); },
    async listByUser(userId) { return [...rows.values()].filter((r) => r.userId === userId); },
    async removeByEndpoint(userId, endpoint) { const r = [...rows.values()].find((x) => x.userId === userId && x.endpoint === endpoint); return r ? rows.delete(r.id) : false; },
    async removeById(id) { rows.delete(id); },
    async setPrefs(userId, endpoint, prefs) { const r = [...rows.values()].find((x) => x.userId === userId && x.endpoint === endpoint); if (!r) return false; Object.assign(r, prefs); return true; },
    async markSent(id) { sentIds.push(id); const r = rows.get(id); if (r) r.failures = 0; },
    async markFailed(id) { const r = rows.get(id); if (r) r.failures++; },
  };
}

async function main(): Promise<void> {
  // ------------------------------------------------------------ manifest
  const m = manifest();
  eq([m.display, m.start_url, m.scope, m.background_color, m.theme_color], ["standalone", "/dashboard", "/", "#0b0f19", "#0b0f19"], "an installable standalone app on the brand's deep black");
  ok(typeof m.name === "string" && m.name.length > 0 && typeof m.short_name === "string" && m.short_name.length <= 12, "a name and a short name that fits under a home-screen icon");
  const icons = m.icons ?? [];
  ok(icons.some((i) => i.sizes === "192x192") && icons.some((i) => i.sizes === "512x512" && i.purpose === "any") && icons.some((i) => i.purpose === "maskable"), "192, 512 and maskable icons are declared");
  for (const i of icons) {
    const file = join(ROOT, "public", i.src.replace(/^\//, ""));
    ok(existsSync(file), `icon file exists: ${i.src}`);
    const meta = await sharp(file).metadata();
    eq(`${meta.width}x${meta.height}`, i.sizes, `the real size of ${i.src} matches what the manifest says`);
  }
  ok((m.shortcuts ?? []).length >= 2 && (m.shortcuts ?? []).every((s) => s.url.startsWith("/")), "shortcuts are same-site paths");
  eq((await sharp(join(ROOT, "public", "pwa", "badge-96.png")).metadata()).hasAlpha, true, "the notification badge has a transparent background");

  // ------------------------------------------------------------ service worker (static + run in a sandbox)
  const sw = readFileSync(join(ROOT, "public", "sw.js"), "utf8");
  ok(!/addEventListener\(\s*["']fetch["']/.test(sw) && !/\bcaches\b/.test(sw.replace(/\/\*[\s\S]*?\*\//g, "")), "the service worker has NO fetch handler and never touches the cache (no stale or cross-user dashboard data)");
  ok(/addEventListener\("push"/.test(sw) && /addEventListener\("notificationclick"/.test(sw), "it handles push and notification taps");
  const events: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const sandbox = {
    URL,
    self: {
      location: { origin: "https://www.algotraders24.ai" },
      skipWaiting: () => undefined,
      clients: {
        claim: async () => undefined,
        matchAll: async () => [] as unknown[],
        openWindow: async (u: string) => { opened.push(u); },
      },
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); } },
      addEventListener: (name: string, fn: (e: unknown) => void) => { events[name] = fn; },
    },
  } as { self: Record<string, unknown> } & Record<string, unknown>;
  vm.runInNewContext(sw, sandbox);
  const pending: Promise<unknown>[] = [];
  const evt = (extra: Record<string, unknown>) => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), ...extra });
  events.push!(evt({ data: { json: () => ({ title: "Margin level low", body: "Account a1b2c3 is at 90%", url: "/dashboard/live-sync", tag: "ls-margin" }) } }));
  events.push!(evt({ data: { json: () => ({ title: "x".repeat(300), body: "y".repeat(900), url: "https://evil.example/phish" }) } }));
  events.push!(evt({ data: { json: () => { throw new Error("not json"); } } }));
  events.push!(evt({ data: undefined }));
  await Promise.all(pending);
  eq(shown.length, 4, "every push shows a notification (a browser requires it)");
  eq([shown[0]!.title, (shown[0]!.options.data as { url: string }).url, shown[0]!.options.tag], ["Margin level low", "/dashboard/live-sync", "ls-margin"], "title, tap target and tag come from the payload");
  ok(shown[1]!.title.length <= 90 && (shown[1]!.options.body as string).length <= 200, "an oversized title/body is cut");
  eq((shown[1]!.options.data as { url: string }).url, "/dashboard", "a tap target on another site falls back to the dashboard");
  eq([shown[2]!.title, shown[3]!.title], ["AT24", "AT24"], "garbage or empty payloads still show a harmless notification");
  ok(shown[0]!.options.icon === "/pwa/icon-192.png" && shown[0]!.options.badge === "/pwa/badge-96.png", "the notification uses the AT24 icon and badge");
  for (const evil of ["https://evil.example/x", "//evil.example", "/\\evil", "javascript:alert(1)"]) {
    const closed: boolean[] = [];
    events.notificationclick!(evt({ notification: { close: () => closed.push(true), data: { url: evil } } }));
  }
  await Promise.all(pending);
  ok(opened.length === 4 && opened.every((u) => u === "https://www.algotraders24.ai/dashboard"), "tapping a notification can only ever open a page on this site");
  events.notificationclick!(evt({ notification: { close: () => undefined, data: { url: "/results/xxxus30-30684e" } } }));
  await Promise.all(pending);
  eq(opened.at(-1), "https://www.algotraders24.ai/results/xxxus30-30684e", "a normal tap opens the right page");
  void navigated;

  // ------------------------------------------------------------ the push endpoint allow-list (SSRF guard)
  for (const good of [FCM, "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB0123456789", "https://web.push.apple.com/QGJz0123456789abcdef", "https://wns2-par02p.notify.windows.com/w/?token=abcdef123456", "https://fcm.googleapis.com:443/fcm/send/abcdefghijk123"]) ok(isAllowedPushEndpoint(good), `accepts ${good.slice(0, 50)}`);
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abcdefghij", "https://localhost/push/abcdefghij", "https://127.0.0.1/push/abcdefghij", "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.5/abcdefghijklmn", "https://[::1]/abcdefghijklmn", "https://fcm.googleapis.com.evil.example/fcm/send/abcdefg", "https://evilfcm.googleapis.com/x/abcdefghijk",
    "https://evil.example/fcm.googleapis.com", "https://user:pass@fcm.googleapis.com/fcm/send/abcdefg", "https://fcm.googleapis.com:8443/fcm/send/abcdefg", "https://push.apple.com.attacker.io/abcdefghijk",
    "https://notify.windows.com/abcdefghijklmnop", "ftp://fcm.googleapis.com/fcm/send/abcdefg", "javascript:alert(1)//fcm.googleapis.com", "not a url at all really", "", "https://fcm.googleapis.com/" + "a".repeat(800),
  ]) ok(!isAllowedPushEndpoint(bad), `refuses ${bad.slice(0, 60)}`);
  for (const nonString of [null, undefined, 5, {}, ["https://fcm.googleapis.com/fcm/send/abcdefg"]]) ok(!isAllowedPushEndpoint(nonString), `refuses a non-string: ${JSON.stringify(nonString)}`);

  // ------------------------------------------------------------ subscription parsing
  eq(parseSubscription({ endpoint: FCM, keys: { p256dh: P256, auth: AUTH } }), { endpoint: FCM, p256dh: P256, auth: AUTH }, "a good subscription is accepted");
  eq(parseSubscription({ endpoint: FCM, keys: { p256dh: P256 + "==", auth: AUTH + "==" } }), { endpoint: FCM, p256dh: P256, auth: AUTH }, "base64 padding is tolerated and removed");
  for (const [bad, why] of [
    [{ endpoint: "https://evil.example/x/abcdefghij", keys: { p256dh: P256, auth: AUTH } }, "a non-push host"], [{ endpoint: FCM }, "no keys"], [{ endpoint: FCM, keys: { p256dh: "short", auth: AUTH } }, "a short p256dh"],
    [{ endpoint: FCM, keys: { p256dh: P256, auth: "a" } }, "a tiny auth"], [{ endpoint: FCM, keys: { p256dh: "!".repeat(87), auth: AUTH } }, "non-base64 key"], [null, "null"], [[], "an array"], ["x", "a string"],
  ] as const) ok(typeof parseSubscription(bad) === "string", `rejects ${why}`);

  // ------------------------------------------------------------ payload
  eq(buildPayload({ title: "  Margin\nlevel  low ", body: "a\tb", url: "/results/x", tag: "t" }), { title: "Margin level low", body: "a b", url: "/results/x", tag: "t" }, "control characters and extra spaces are cleaned");
  eq(buildPayload({ title: "" }).title, "AT24", "an empty title becomes AT24");
  eq([safeNotificationPath("/dashboard/live-sync"), safeNotificationPath("//evil.example"), safeNotificationPath("https://evil.example"), safeNotificationPath("/a\\b"), safeNotificationPath("/ok\nbad"), safeNotificationPath(5), safeNotificationPath(undefined)], ["/dashboard/live-sync", "/dashboard", "/dashboard", "/dashboard", "/dashboard", "/dashboard", "/dashboard"], "the tap target is only ever a path on this site");

  // ------------------------------------------------------------ delivery
  {
    const store = fakeStore([{ id: "a" }, { id: "b" }]);
    const calls: { endpoint: string; title: string }[] = [];
    const send: PushSender = async (s, p) => { calls.push({ endpoint: s.endpoint, title: p.title }); return { ok: true, status: 201 }; };
    eq(await sendPushToUser("u1", "alerts", { title: "T" }, { store, send, enabled: true }), 2, "every device of the user gets it");
    eq(calls.length, 2, "two sends");
    eq(await sendPushToUser("nobody", "alerts", { title: "T" }, { store, send, enabled: true }), 0, "a user without devices gets nothing");
    eq(await sendPushToUser("u1", "alerts", { title: "T" }, { store, send, enabled: false }), 0, "disabled (no keys) = nothing, no store access");
    store.rows.get("a")!.alertsOn = false;
    eq(await sendPushToUser("u1", "alerts", { title: "T" }, { store, send, enabled: true }), 1, "a device with alerts switched off is skipped");
    eq(await sendPushToUser("u1", "watch", { title: "T" }, { store, send, enabled: true }), 2, "watch notices have their own switch");
    store.rows.get("b")!.watchOn = false;
    eq(await sendPushToUser("u1", "watch", { title: "T" }, { store, send, enabled: true }), 1, "and a device can turn them off");
  }
  {
    const store = fakeStore([{ id: "gone" }, { id: "flaky" }, { id: "fine" }]);
    const send: PushSender = async (s) => (s.endpoint.endsWith("gone") ? { ok: false, status: 410 } : s.endpoint.endsWith("flaky") ? { ok: false, status: 500 } : { ok: true, status: 201 });
    eq(await sendPushToUser("u1", "alerts", { title: "T" }, { store, send, enabled: true }), 1, "only the healthy device accepted it");
    ok(!store.rows.has("gone"), "a 410 (unsubscribed / uninstalled) deletes the subscription");
    eq([store.rows.get("flaky")?.failures, store.rows.has("fine")], [1, true], "another failure only counts, a healthy one stays");
    for (let i = 0; i < MAX_FAILURES; i++) await sendPushToUser("u1", "alerts", { title: "T" }, { store, send, enabled: true });
    ok(!store.rows.has("flaky"), `a device that fails ${MAX_FAILURES} times in a row is dropped`);
    const s404 = fakeStore([{ id: "x" }]);
    await sendPushToUser("u1", "alerts", { title: "T" }, { store: s404, send: async () => ({ ok: false, status: 404 }), enabled: true });
    eq(s404.rows.size, 0, "a 404 deletes it too");
    const boom = fakeStore([{ id: "z" }]);
    eq(await sendPushToUser("u1", "alerts", { title: "T" }, { store: boom, send: async () => { throw new Error("net"); }, enabled: true }), 0, "a sender that throws never throws out of the alert path");
    const evilRow = fakeStore([{ id: "e", endpoint: "https://169.254.169.254/latest/meta-data/xxxxxxxx" }]);
    let called = 0;
    await sendPushToUser("u1", "alerts", { title: "T" }, { store: evilRow, send: async () => { called++; return { ok: true, status: 201 }; }, enabled: true });
    eq(called, 0, "even a bad endpoint already in the database is never called (the guard runs at send time too)");
  }
  {
    const store = fakeStore();
    for (let i = 0; i < 7; i++) await store.upsert("u1", { endpoint: `${FCM}-${i}`, p256dh: P256, auth: AUTH }, null);
    ok((await store.listByUser("u1")).length <= MAX_SUBSCRIPTIONS_PER_USER, `at most ${MAX_SUBSCRIPTIONS_PER_USER} devices per user`);
    await store.upsert("u2", { endpoint: `${FCM}-6`, p256dh: P256, auth: AUTH }, null);
    ok((await store.listByUser("u2")).length === 1 && (await store.listByUser("u1")).every((r) => r.endpoint !== `${FCM}-6`), "a device endpoint belongs to one user: re-registering moves it, it is never shared");
  }

  // ------------------------------------------------------------ config
  const KEY = (n: number) => "A".repeat(n);
  eq(pushConfig({}).enabled, false, "nothing configured = disabled");
  eq(pushConfig({ PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: KEY(87), VAPID_PRIVATE_KEY: KEY(43), VAPID_SUBJECT: "mailto:support@algotraders24.com" }).enabled, true, "flag + both keys + a mailto subject = enabled");
  eq(pushConfig({ PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: KEY(87), VAPID_PRIVATE_KEY: KEY(43), VAPID_SUBJECT: "https://www.algotraders24.ai" }).enabled, true, "an https subject also works");
  for (const [env, why] of [
    [{ VAPID_PUBLIC_KEY: KEY(87), VAPID_PRIVATE_KEY: KEY(43), VAPID_SUBJECT: "mailto:a@b.co" }, "keys without the enabled flag"],
    [{ PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: KEY(86), VAPID_PRIVATE_KEY: KEY(43), VAPID_SUBJECT: "mailto:a@b.co" }, "a short public key"],
    [{ PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: KEY(87), VAPID_PRIVATE_KEY: KEY(42), VAPID_SUBJECT: "mailto:a@b.co" }, "a short private key"],
    [{ PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: KEY(87), VAPID_PRIVATE_KEY: KEY(43), VAPID_SUBJECT: "not a subject" }, "a bad subject"],
    [{ PUSH_ENABLED: "true", VAPID_PUBLIC_KEY: KEY(87) , VAPID_SUBJECT: "mailto:a@b.co" }, "no private key"],
  ] as const) eq(pushConfig(env as Record<string, string>).enabled, false, `disabled with ${why}`);

  // ------------------------------------------------------------ client helpers
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
  const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
  eq([detectPlatform(IPHONE), detectPlatform(ANDROID), detectPlatform(WIN), detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)], ["ios", "android", "desktop", "ios", "desktop"], "platform detection (iPadOS as a touch Mac is iOS)");
  eq([pushNeedsHomeScreen("ios", false), pushNeedsHomeScreen("ios", true), pushNeedsHomeScreen("android", false)], [true, false, false], "iOS needs the home-screen install before push; other platforms do not");
  eq([installHint({ platform: "android", standalone: true, hasPrompt: false }), installHint({ platform: "android", standalone: false, hasPrompt: true }), installHint({ platform: "ios", standalone: false, hasPrompt: false }), installHint({ platform: "android", standalone: false, hasPrompt: false }), installHint({ platform: "desktop", standalone: false, hasPrompt: false })], ["installed", "prompt", "ios-steps", "browser-menu", "none"], "the install card offers the right thing per situation");
  const bytes = urlBase64ToUint8Array("AQIDBA");
  eq(Array.from(bytes), [1, 2, 3, 4], "VAPID key decoding (base64url, no padding)");
  const NOW = Date.UTC(2026, 9, 10);
  eq([installBannerHidden(null, NOW), installBannerHidden(NOW - 86_400_000, NOW), installBannerHidden(NOW - (INSTALL_DISMISS_DAYS + 1) * 86_400_000, NOW)], [false, true, false], "a dismissed install banner stays away for 30 days");

  // ------------------------------------------------------------ files
  const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  ok(/source: "\/sw\.js"[\s\S]{0,400}no-cache[\s\S]{0,200}Service-Worker-Allowed/.test(cfg), "the service worker is served uncached and may control the whole site");
  const sql = readFileSync(join(ROOT, "prisma", "migrations", "20261012100000_add_push_subscriptions", "migration.sql"), "utf8");
  eq([...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((x) => x[1]), ["push_subscriptions"], "the migration creates exactly one new table");
  ok(!/\bDROP\b|\bALTER TABLE\b|\bDELETE\b|\bUPDATE\b/i.test(sql), "the migration only adds");
  const route = readFileSync(join(ROOT, "app", "api", "private", "push", "route.ts"), "utf8");
  ok(/parseSubscription\(body\.subscription\)/.test(route) && /isAllowedPushEndpoint\(/.test(route), "the API validates every endpoint before storing or using it");
  const layout = readFileSync(join(ROOT, "app", "dashboard", "layout.tsx"), "utf8");
  ok(layout.includes("<PwaProvider />"), "the dashboard registers the service worker and shows the install bar");

  console.log(`validate-pwa: ${checks} checks passed`);
}

void main();
