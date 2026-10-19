// services/whatsapp/webhook.ts
// Handles one verified WhatsApp Cloud API webhook payload. STATELESS apart from two small in-memory guards (message-id
// dedupe, per-sender rate limit), so it needs no database or migration. It answers ONLY from the public support knowledge
// base (answerGuestQuestion: the same anonymous path as the website widget, which structurally cannot reach account data)
// and hands over to a human by alerting the owner. It never gives trading advice, never touches an account, and never
// throws: Meta retries a failed webhook, so the caller always answers 200.
import { answerGuestQuestion, type GuestAnswer } from "@/services/support/guest-knowledge-query";
import type { WhatsAppClient } from "./client";
import { adviceRefusalMessage, answerMessage, classify, escalationMessage, greetingMessage, nonTextMessage, ownerAlertText, stopMessage } from "./messages";

const MAX_QUESTION_CHARS = 1000;
const MAX_AGE_SECONDS = 600; // ignore messages Meta delivers more than 10 minutes late
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
const SEEN_MAX = 2000;
const ALERT_COOLDOWN_MS = 10 * 60_000;
// When the owner types a reply from the WhatsApp Business app (coexistence mode delivers it as a "message echo"), the bot stays
// quiet for that customer for a while so it never talks over a person.
const HUMAN_MUTE_MS = 12 * 60 * 60_000;

export interface WaGuards {
  seen: Set<string>;
  hits: Map<string, number[]>;
  alerted: Map<string, number>;
  /** customer number -> epoch ms until which the bot stays silent (a human answered from the app). */
  muted: Map<string, number>;
}
export const newGuards = (): WaGuards => ({ seen: new Set(), hits: new Map(), alerted: new Map(), muted: new Map() });
const processGuards = newGuards();

export interface WaDeps {
  client: WhatsAppClient;
  siteUrl: string;
  answer?: (query: string) => Promise<GuestAnswer>;
  /** Sends an alert to the owner (private Telegram chat). Optional: when absent the escalation is only logged. */
  alertOwner?: (text: string) => Promise<void>;
  now?: () => number;
  guards?: WaGuards;
}

export interface WaSummary {
  received: number;
  replied: number;
  escalated: number;
  ignored: number;
}

interface WaMessage {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  timestamp?: unknown;
  text?: { body?: unknown };
}

function messagesOf(payload: unknown): WaMessage[] {
  const out: WaMessage[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const changes = (e as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const msgs = (c as { value?: { messages?: unknown } })?.value?.messages;
      if (Array.isArray(msgs)) out.push(...(msgs as WaMessage[]));
    }
  }
  return out;
}

/** Numbers the owner wrote to from the app (smb_message_echoes). Only the recipient is read. */
function echoRecipients(payload: unknown): string[] {
  const out: string[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    const changes = (e as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const echoes = (c as { value?: { message_echoes?: unknown } })?.value?.message_echoes;
      if (!Array.isArray(echoes)) continue;
      for (const echo of echoes) {
        const to = (echo as { to?: unknown })?.to;
        if (typeof to === "string" && /^\d{6,20}$/.test(to)) out.push(to);
      }
    }
  }
  return out;
}

function limited(g: WaGuards, from: string, nowMs: number): boolean {
  const recent = (g.hits.get(from) ?? []).filter((t) => nowMs - t < RATE_WINDOW_MS);
  recent.push(nowMs);
  g.hits.set(from, recent);
  if (g.hits.size > 5000) g.hits.clear();
  return recent.length > RATE_MAX;
}

export async function handleWhatsAppPayload(payload: unknown, deps: WaDeps): Promise<WaSummary> {
  const g = deps.guards ?? processGuards;
  const nowMs = (deps.now ?? Date.now)();
  const answer = deps.answer ?? answerGuestQuestion;
  const summary: WaSummary = { received: 0, replied: 0, escalated: 0, ignored: 0 };

  for (const to of echoRecipients(payload)) {
    g.muted.set(to, nowMs + HUMAN_MUTE_MS);
    if (g.muted.size > 2000) g.muted.clear();
  }

  for (const m of messagesOf(payload)) {
    summary.received++;
    try {
      const id = typeof m.id === "string" ? m.id : "";
      const from = typeof m.from === "string" && /^\d{6,20}$/.test(m.from) ? m.from : "";
      if (!id || !from || g.seen.has(id)) { summary.ignored++; continue; }
      g.seen.add(id);
      if (g.seen.size > SEEN_MAX) { g.seen.clear(); g.seen.add(id); }
      const sentAt = Number(m.timestamp);
      if (Number.isFinite(sentAt) && sentAt > 0 && nowMs / 1000 - sentAt > MAX_AGE_SECONDS) { summary.ignored++; continue; }
      if ((g.muted.get(from) ?? 0) > nowMs) { summary.ignored++; continue; }
      if (limited(g, from, nowMs)) { summary.ignored++; continue; }

      const send = async (text: string): Promise<void> => {
        const r = await deps.client.sendText(from, text);
        if (r.ok) summary.replied++;
      };
      const escalate = async (question: string, why: string, reason: "no-answer" | "requested"): Promise<void> => {
        summary.escalated++;
        const last = g.alerted.get(from) ?? 0;
        if (deps.alertOwner && nowMs - last >= ALERT_COOLDOWN_MS) {
          g.alerted.set(from, nowMs);
          if (g.alerted.size > 2000) g.alerted.clear();
          await deps.alertOwner(ownerAlertText(from, question, why)).catch(() => undefined);
        }
        await send(escalationMessage(deps.siteUrl, reason));
      };

      if (m.type !== "text") { await send(nonTextMessage()); continue; }
      const body = typeof m.text?.body === "string" ? m.text.body.trim().slice(0, MAX_QUESTION_CHARS) : "";
      if (body.length === 0) { summary.ignored++; continue; }

      const intent = classify(body);
      if (intent === "stop") { await send(stopMessage()); continue; }
      if (intent === "greeting") { await send(greetingMessage(deps.siteUrl)); continue; }
      if (intent === "advice") { await send(adviceRefusalMessage()); continue; }
      if (intent === "human") { await escalate(body, "asked for a person", "requested"); continue; }

      const a = await answer(body);
      if (!a.escalate && a.citations.length > 0) await send(answerMessage(a, deps.siteUrl));
      else await escalate(body, a.escalationReason ?? "no confident answer", "no-answer");
    } catch (err) {
      summary.ignored++;
      console.error("[whatsapp] message handling failed (non-fatal)", err instanceof Error ? err.message : "unknown");
    }
  }
  return summary;
}
