// services/whatsapp/messages.ts
// The words the bot says. Plain text (WhatsApp renders *bold* and nothing else we need). Nothing here ever gives a buy/sell
// call, a target, a profit figure or a guarantee: answers are only the support knowledge base's own text, and every reply
// that could be read as market talk carries the not-financial-advice line.
import type { GuestAnswer } from "@/services/support/guest-knowledge-query";

export const NOT_ADVICE = "Not financial advice.";
const ANSWER_MAX = 1500;

export function greetingMessage(siteUrl: string): string {
  return [
    "Hi, this is the Algotraders24 AI assistant.",
    "",
    "Ask me about plans and credits, marketplace products and licences, or how to get started. Type HUMAN any time to reach our team.",
    "",
    `Start free: ${siteUrl}`,
    NOT_ADVICE,
  ].join("\n");
}

export function answerMessage(answer: GuestAnswer, siteUrl: string): string {
  const best = answer.citations[0];
  const body = best.content.length > ANSWER_MAX ? `${best.content.slice(0, ANSWER_MAX)}…` : best.content;
  return [`*${best.title}*`, "", body, "", `More: ${siteUrl}`, "Type HUMAN to reach our team.", NOT_ADVICE].join("\n");
}

export function escalationMessage(siteUrl: string, reason: "no-answer" | "requested"): string {
  const lead =
    reason === "requested"
      ? "Sure, I have passed this to our team."
      : "I could not find a reliable answer in our support knowledge base, so I have passed your question to our team.";
  return [lead, "They will reply here as soon as they can.", "", `For account-specific help (billing, licences, credits) you can also sign in at ${siteUrl}/login.`, NOT_ADVICE].join("\n");
}

export function adviceRefusalMessage(): string {
  return [
    "We do not give buy/sell calls, signals, targets or return promises, and no tool of ours can promise a result.",
    "What we can do: explain how the platform works, what its products do and how to test them yourself.",
    NOT_ADVICE,
  ].join("\n");
}

export function nonTextMessage(): string {
  return "I can read text messages only. Please type your question, or type HUMAN to reach our team.";
}

export function stopMessage(): string {
  return "Understood. We will not message you unless you write to us first.";
}

/** Owner alert (private Telegram chat). Plain text: the Telegram client sends HTML mode, so the caller escapes it. */
export function ownerAlertText(from: string, question: string, why: string): string {
  return `WhatsApp: a person is needed\nFrom: +${from}\nWhy: ${why}\nMessage: ${question.slice(0, 500)}\n\nReply from the WhatsApp Business app or the Cloud API inbox.`;
}

const GREETING = /^(hi|hii+|hello|hey|hola|salam|salaam|namaste|start|menu|help|good (morning|evening|afternoon))\b[\s!.?]*$/i;
const STOP = /^(stop|unsubscribe|opt ?out|cancel messages?)[\s!.]*$/i;
const HUMAN = /^(human|agent|person|support|team|talk to (a )?(human|person|agent)|connect me)[\s!.?]*$/i;
const ADVICE =
  /\b(should i|shall i|kya)\s+(buy|sell)\b|\b(buy|sell)\s+(or|ya)\s+(buy|sell)\b|\b(give|send|share|need)\s+(me\s+)?(a\s+|some\s+)?(signals?|tips?|calls?|entry)\b|\bsignals?\s+(for|today|now)\b|\bguarantee[sd]?\b.*\b(profit|returns?)\b|\bwill\s+(gold|xau\w*|btc|bitcoin|us30|eur\w*|silver)\s+(go|rise|fall|drop|pump|reach)\b/i;

export type Intent = "greeting" | "stop" | "human" | "advice" | "question";

export function classify(text: string): Intent {
  const t = text.trim();
  if (STOP.test(t)) return "stop";
  if (HUMAN.test(t)) return "human";
  if (GREETING.test(t)) return "greeting";
  if (ADVICE.test(t)) return "advice";
  return "question";
}
