// Validates the AT24 WhatsApp support bot: config, signature + handshake, client, intent routing, replies, webhook handling. No network, no database.
import assert from "node:assert/strict";
import { whatsappConfig } from "../services/whatsapp/config";
import { whatsappHref } from "../config/whatsapp";
import { signBody, signatureValid, verifyHandshake } from "../services/whatsapp/signature";
import { createWhatsAppClient, MAX_WA_TEXT, type WaFetchLike } from "../services/whatsapp/client";
import { classify, answerMessage, escalationMessage, greetingMessage, adviceRefusalMessage, NOT_ADVICE, ownerAlertText } from "../services/whatsapp/messages";
import { handleWhatsAppPayload, newGuards, type WaDeps } from "../services/whatsapp/webhook";
import type { GuestAnswer } from "../services/support/guest-knowledge-query";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const SITE = "https://www.algotraders24.ai";
const TOKEN = "EAAB_fake_token_for_tests_only_0123456789";
const SECRET = "0123456789abcdef0123";

const kbAnswer = (over: Partial<GuestAnswer> = {}): GuestAnswer => ({
  coverage: "kb-answered",
  citations: [{ topic: "billing", title: "What is a credit?", content: "1 credit = 1 AI chat message.", relevance: 0.9 }],
  escalate: false,
  escalationReason: null,
  disclaimer: "x",
  ...over,
});
const noAnswer = (): GuestAnswer => ({ coverage: "no-coverage", citations: [], escalate: true, escalationReason: "the-support-knowledge-base-did-not-contain-an-answer", disclaimer: "x" });

function rig(answer: (q: string) => Promise<GuestAnswer>, o: { now?: number } = {}) {
  const sent: { to: string; text: string }[] = [];
  const alerts: string[] = [];
  const asked: string[] = [];
  const deps: WaDeps = {
    client: { async sendText(to, text) { sent.push({ to, text }); return { ok: true, status: 200, messageId: `wamid.${sent.length}` }; } },
    siteUrl: SITE,
    answer: async (q) => { asked.push(q); return answer(q); },
    alertOwner: async (t) => { alerts.push(t); },
    now: () => o.now ?? 1_800_000_000_000,
    guards: newGuards(),
  };
  return { deps, sent, alerts, asked };
}
const NOW_S = 1_800_000_000;
const payload = (msgs: Record<string, unknown>[]) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages: msgs } }] }] });
const text = (id: string, body: string, from = "971500000001", ts = NOW_S) => ({ id, from, type: "text", timestamp: String(ts), text: { body } });

async function main(): Promise<void> {
  // ------------------------------------------------------------ config
  eq(whatsappConfig({}).enabled, false, "nothing configured = disabled");
  eq(whatsappConfig({ WHATSAPP_ENABLED: "true" }).enabled, false, "flag alone = disabled");
  eq(whatsappConfig({ WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "123456789012345" }).enabled, false, "no app secret = disabled");
  eq(whatsappConfig({ WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "not-a-number", WHATSAPP_APP_SECRET: SECRET }).enabled, false, "bad phone-number id = disabled");
  eq(whatsappConfig({ WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "123456789012345", WHATSAPP_APP_SECRET: SECRET }).enabled, true, "flag + token + id + secret = enabled");
  eq(whatsappConfig({}).graphVersion, "v21.0", "default graph version");
  eq(whatsappConfig({ WHATSAPP_SITE_URL: "https://x.test///" }).siteUrl, "https://x.test", "site url trailing slashes trimmed");

  // ------------------------------------------------------------ click-to-chat link
  eq(whatsappHref(), "https://wa.me/971567355276", "no prefill = plain chat link");
  eq(whatsappHref('Hi, a question about "XXX Gold" & more'), "https://wa.me/971567355276?text=Hi%2C%20a%20question%20about%20%22XXX%20Gold%22%20%26%20more", "the prefill is URL-encoded");
  ok(whatsappHref("x".repeat(1000)).length < 400, "a long prefill is cut");

  // ------------------------------------------------------------ signature + handshake
  const raw = JSON.stringify(payload([text("a", "hi")]));
  ok(signatureValid(raw, signBody(raw, SECRET), SECRET), "a correct signature is accepted");
  ok(!signatureValid(raw, signBody(raw, "another-secret-value"), SECRET), "a signature from another secret is rejected");
  ok(!signatureValid(raw + " ", signBody(raw, SECRET), SECRET), "a tampered body is rejected");
  ok(!signatureValid(raw, null, SECRET), "a missing header is rejected");
  ok(!signatureValid(raw, signBody(raw, SECRET), ""), "an empty secret never validates");
  ok(!signatureValid(raw, "sha256=abc", SECRET), "a short signature is rejected without throwing");
  eq(verifyHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "42" }), "tok"), "42", "handshake echoes the challenge");
  eq(verifyHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "42" }), "tok"), null, "wrong verify token is refused");
  eq(verifyHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "42" }), ""), null, "an unset verify token refuses everything");
  eq(verifyHandshake(new URLSearchParams({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "42" }), "tok"), null, "only subscribe is accepted");

  // ------------------------------------------------------------ client
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fakeFetch: WaFetchLike = async (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return { status: 200, async json() { return { messages: [{ id: "wamid.X" }] }; } }; };
  const client = createWhatsAppClient({ accessToken: TOKEN, phoneNumberId: "123456789012345" }, fakeFetch);
  const r = await client.sendText("971500000001", "hello");
  ok(r.ok && r.messageId === "wamid.X", "a send returns the message id");
  ok(calls[0].url === "https://graph.facebook.com/v21.0/123456789012345/messages", "posts to the phone-number messages endpoint");
  ok(calls[0].headers.authorization === `Bearer ${TOKEN}`, "token goes in the Authorization header");
  ok(!calls[0].url.includes(TOKEN), "token is never in the URL");
  const sentBody = JSON.parse(calls[0].body) as { to: string; type: string; text: { body: string } };
  ok(sentBody.to === "971500000001" && sentBody.type === "text" && sentBody.text.body === "hello", "payload shape");
  await client.sendText("971500000001", "x".repeat(10_000));
  ok((JSON.parse(calls[1].body) as { text: { body: string } }).text.body.length === MAX_WA_TEXT, "long text is cut to the limit");
  const failing = createWhatsAppClient({ accessToken: TOKEN, phoneNumberId: "123456789012345" }, async () => ({ status: 401, async json() { return { error: { message: "Invalid OAuth access token" } }; } }));
  const fr = await failing.sendText("971500000001", "x");
  ok(!fr.ok && fr.status === 401 && fr.description === "Invalid OAuth access token", "a failed send reports status and reason");
  const boom = createWhatsAppClient({ accessToken: TOKEN, phoneNumberId: "123456789012345" }, async () => { throw new Error("net"); });
  const br = await boom.sendText("971500000001", "x");
  ok(!br.ok && br.status === 0, "a network error never throws");

  // ------------------------------------------------------------ intent routing
  eq(classify("hi"), "greeting", "hi is a greeting");
  eq(classify("Hello!"), "greeting", "Hello! is a greeting");
  eq(classify("menu"), "greeting", "menu is a greeting");
  eq(classify("STOP"), "stop", "STOP opts out");
  eq(classify("human"), "human", "HUMAN asks for a person");
  eq(classify("talk to a person"), "human", "talk to a person asks for a person");
  eq(classify("should i buy gold now"), "advice", "should i buy = advice-seeking");
  eq(classify("buy or sell?"), "advice", "buy or sell = advice-seeking");
  eq(classify("give me a signal for gold"), "advice", "give me a signal = advice-seeking");
  eq(classify("will bitcoin go up tomorrow"), "advice", "price prediction = advice-seeking");
  eq(classify("is it guaranteed profit?"), "advice", "a return-guarantee question gets the no-promises answer");
  eq(classify("can I sell my EA on the marketplace"), "question", "a seller question is NOT advice-seeking");
  eq(classify("how much does the Pro plan cost"), "question", "a pricing question is a normal question");

  // ------------------------------------------------------------ messages
  const am = answerMessage(kbAnswer(), SITE);
  ok(am.includes("What is a credit?") && am.includes("1 credit = 1 AI chat message.") && am.includes(NOT_ADVICE), "an answer carries the title, the text and the disclaimer");
  const long = answerMessage(kbAnswer({ citations: [{ topic: "t", title: "T", content: "y".repeat(5000), relevance: 1 }] }), SITE);
  ok(long.length < 1800, "a long knowledge chunk is trimmed");
  ok(escalationMessage(SITE, "no-answer").includes("passed your question to our team") && escalationMessage(SITE, "no-answer").includes(`${SITE}/login`), "escalation explains the hand-over and points to sign-in");
  ok(greetingMessage(SITE).includes(SITE) && greetingMessage(SITE).includes(NOT_ADVICE), "greeting links the site and carries the disclaimer");
  ok(!/\b(guarantee|will profit|target price)\b/i.test(adviceRefusalMessage().replace(/no tool of ours can promise a result/i, "")), "the refusal makes no promises");
  ok(ownerAlertText("971500000001", "q", "why").includes("+971500000001"), "owner alert shows the sender number");

  // ------------------------------------------------------------ webhook handling
  let t = rig(async () => kbAnswer());
  let s = await handleWhatsAppPayload(payload([text("m1", "how much is a credit")]), t.deps);
  eq(s, { received: 1, replied: 1, escalated: 0, ignored: 0 }, "a covered question gets a KB answer");
  ok(t.sent[0].to === "971500000001" && t.sent[0].text.includes("1 credit = 1 AI chat message."), "the answer goes to the sender");
  eq(t.asked, ["how much is a credit"], "the question reaches the knowledge base");

  t = rig(async () => noAnswer());
  s = await handleWhatsAppPayload(payload([text("m2", "weird thing nobody documented")]), t.deps);
  eq(s, { received: 1, replied: 1, escalated: 1, ignored: 0 }, "an unanswerable question escalates and still replies");
  eq(t.alerts.length, 1, "the owner is alerted once");
  ok(t.alerts[0].includes("+971500000001") && t.alerts[0].includes("weird thing nobody documented"), "the alert names the sender and the question");

  t = rig(async () => noAnswer());
  await handleWhatsAppPayload(payload([text("m3", "first unknown"), text("m4", "second unknown")]), t.deps);
  eq(t.alerts.length, 1, "repeated escalations from one sender inside the cooldown alert the owner once");
  eq(t.sent.length, 2, "…but the sender still gets a reply each time");

  t = rig(async () => kbAnswer({ escalate: true }));
  s = await handleWhatsAppPayload(payload([text("m5", "cancel my subscription")]), t.deps);
  eq(s.escalated, 1, "an answer flagged escalate (account change) goes to a human, not a canned KB answer");

  t = rig(async () => kbAnswer());
  s = await handleWhatsAppPayload(payload([text("m6", "human")]), t.deps);
  eq(s, { received: 1, replied: 1, escalated: 1, ignored: 0 }, "HUMAN escalates");
  eq(t.asked.length, 0, "HUMAN does not query the knowledge base");

  t = rig(async () => kbAnswer());
  await handleWhatsAppPayload(payload([text("m7", "hi")]), t.deps);
  ok(t.sent[0].text.includes("Algotraders24 AI assistant") && t.asked.length === 0, "a greeting gets the greeting, not a KB lookup");

  t = rig(async () => kbAnswer());
  await handleWhatsAppPayload(payload([text("m8", "should i buy gold now")]), t.deps);
  ok(t.sent[0].text.includes("do not give buy/sell calls") && t.asked.length === 0 && t.alerts.length === 0, "advice-seeking is refused politely, with no KB lookup and no owner alert");

  t = rig(async () => kbAnswer());
  await handleWhatsAppPayload(payload([text("m9", "STOP")]), t.deps);
  ok(t.sent[0].text.includes("will not message you unless you write"), "STOP is acknowledged");

  t = rig(async () => kbAnswer());
  s = await handleWhatsAppPayload(payload([{ id: "m10", from: "971500000001", type: "image", timestamp: String(NOW_S) }]), t.deps);
  ok(s.replied === 1 && t.sent[0].text.includes("text messages only"), "a non-text message gets a short note");

  t = rig(async () => kbAnswer());
  await handleWhatsAppPayload(payload([text("dup", "how much is a credit")]), t.deps);
  s = await handleWhatsAppPayload(payload([text("dup", "how much is a credit")]), t.deps);
  eq(s.ignored, 1, "a redelivered message id is ignored");
  eq(t.sent.length, 1, "…and answered only once");

  t = rig(async () => kbAnswer());
  s = await handleWhatsAppPayload(payload([text("old", "how much is a credit", "971500000001", NOW_S - 3600)]), t.deps);
  eq(s.ignored, 1, "an hour-old delivery is ignored");

  t = rig(async () => kbAnswer());
  const burst = Array.from({ length: 12 }, (_, i) => text(`b${i}`, "how much is a credit"));
  s = await handleWhatsAppPayload(payload(burst), t.deps);
  eq(s.replied, 8, "a sender is rate-limited to 8 messages a minute");
  eq(s.ignored, 4, "…the rest are silently ignored");

  t = rig(async () => { throw new Error("db down"); });
  s = await handleWhatsAppPayload(payload([text("err", "how much is a credit")]), t.deps);
  eq(s.ignored, 1, "a failing knowledge lookup never throws out of the handler");

  t = rig(async () => kbAnswer());
  eq(await handleWhatsAppPayload({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "s1", status: "delivered" }] } }] }] }, t.deps), { received: 0, replied: 0, escalated: 0, ignored: 0 }, "delivery-status callbacks are not messages");
  eq(await handleWhatsAppPayload(null, t.deps), { received: 0, replied: 0, escalated: 0, ignored: 0 }, "a null payload is harmless");
  eq(await handleWhatsAppPayload({ entry: "nope" }, t.deps), { received: 0, replied: 0, escalated: 0, ignored: 0 }, "a malformed payload is harmless");
  s = await handleWhatsAppPayload(payload([text("badnum", "hello", "not-a-number")]), t.deps);
  eq(s.ignored, 1, "a sender id that is not a phone number is ignored");

  // ------------------------------------------------------------ human takeover (coexistence echoes)
  const echo = (to: string) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "smb_message_echoes", value: { message_echoes: [{ from: "971567355276", to, id: "e1", type: "text", text: { body: "Hi, this is Pravin" } }] } }] }] });
  t = rig(async () => kbAnswer());
  eq(await handleWhatsAppPayload(echo("971500000009"), t.deps), { received: 0, replied: 0, escalated: 0, ignored: 0 }, "an echo is not a customer message");
  s = await handleWhatsAppPayload(payload([text("after-echo", "how much is a credit", "971500000009")]), t.deps);
  eq(s.ignored, 1, "after the owner wrote from the app, the bot stays silent for that customer");
  eq(t.sent.length, 0, "…and sends nothing");
  s = await handleWhatsAppPayload(payload([text("other-customer", "how much is a credit", "971500000010")]), t.deps);
  eq(s.replied, 1, "other customers are still answered");
  t.deps.now = () => 1_800_000_000_000 + 13 * 60 * 60_000;
  s = await handleWhatsAppPayload(payload([text("later", "how much is a credit", "971500000009", NOW_S + 13 * 3600)]), t.deps);
  eq(s.replied, 1, "the bot answers again 12+ hours after the human's last message");
  eq(await handleWhatsAppPayload({ entry: [{ changes: [{ value: { message_echoes: [{ to: "bad" }, null, { to: 5 }] } }] }] }, t.deps), { received: 0, replied: 0, escalated: 0, ignored: 0 }, "malformed echoes are harmless");

  console.log(`validate-whatsapp: ${checks} checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
