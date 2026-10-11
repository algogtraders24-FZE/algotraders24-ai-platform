// services/automation/delivery.ts
// AT24 Automation Phase 2 - delivers a SUCCEEDED run's result to the user.
//
// Reuses the three channels that already exist (no new infrastructure, no
// migration): the in-app bell (UserNotification), the user's own linked
// Telegram chat, and their own Web Push devices. Telegram and push stay
// subject to the user's own link / subscription / "alerts" switch, exactly
// like every other AT24 alert - a user who never connected Telegram simply
// gets nothing there.
//
// Rules (AUTOMATION_P2_DELIVERY.md):
//  - Only a SUCCEEDED run delivers. A run halted by a condition delivers
//    nothing (that is how "notify me only when X" works); failures keep their
//    existing email path.
//  - Nothing worth reporting (every agent brief empty) => nothing is sent, so
//    a user is never pinged with "no matching sources" every morning.
//  - Delivery re-states the agents' own output; it adds no claim of its own,
//    never a trade instruction, and always carries the decision-support line.
//  - Best effort: never throws, never changes the run's outcome.

import type { AutomationDeliveryChannel, AutomationWorkflowDefinition } from "@/types/automation";
import { composeAgentBrief, type AgentBrief } from "./brief";
import { escapeHtml } from "@/services/telegram/client";

export const DELIVERY_NOTIFICATION_KIND = "automation_result";
const DEFAULT_CHANNELS: AutomationDeliveryChannel[] = ["bell"];
const DECISION_SUPPORT = "Decision support only, not a trade recommendation. AT24 never trades for you.";

/** No `delivery` => in-app bell only. An explicit empty list turns delivery off. */
export function resolveDeliveryChannels(def: Pick<AutomationWorkflowDefinition, "delivery">): AutomationDeliveryChannel[] {
  const c = def.delivery?.channels;
  if (!Array.isArray(c)) return [...DEFAULT_CHANNELS];
  return [...new Set(c)];
}

export interface DeliveryMessage {
  title: string;
  /** In-app / push body: just the headlines. */
  short: string;
  /** Telegram HTML. */
  telegramHtml: string;
}

/** Builds the messages, or null when every brief is empty. Pure. */
export function buildDeliveryMessage(args: {
  automationName: string;
  briefs: readonly (AgentBrief | null)[];
  href: string;
  siteUrl: string;
}): DeliveryMessage | null {
  const useful = args.briefs.filter((b): b is AgentBrief => b !== null && !b.empty);
  if (useful.length === 0) return null;

  const name = args.automationName.trim() || "Automation";
  const short = useful.map((b) => b.headline).join("\n").slice(0, 560);

  const blocks = useful.map((b) => [`<b>${escapeHtml(b.headline)}</b>`, ...b.lines.map((l) => `• ${escapeHtml(l)}`)].join("\n"));
  let html = `<b>${escapeHtml(name)}</b>\n\n${blocks.join("\n\n")}`;
  if (html.length > 3300) html = `${html.slice(0, 3299)}…`;
  html += `\n\n<a href="${escapeHtml(args.siteUrl + args.href)}">Open the full run on AT24</a>\n<i>${escapeHtml(DECISION_SUPPORT)}</i>`;

  return { title: name.slice(0, 120), short, telegramHtml: html };
}

export interface DeliveryDeps {
  notify?: (p: { userId: string; kind: string; severity: "info"; title: string; body: string; href: string }) => Promise<void>;
  telegram?: (userId: string, text: string) => Promise<boolean>;
  push?: (userId: string, msg: { title: string; body: string; url: string; tag: string }) => Promise<number>;
  siteUrl?: string;
}

export interface DeliveryReport {
  status: "delivered" | "skipped";
  reason?: "delivery-off" | "nothing-to-report";
  channels: Partial<Record<AutomationDeliveryChannel, boolean | number>>;
}

export interface DeliveryInput {
  userId: string;
  automationId: string;
  automationName: string;
  runId: string;
  definition: Pick<AutomationWorkflowDefinition, "delivery">;
  /** Raw output of each agent_run step's child AgentRun, in step order. */
  agentOutputs: readonly unknown[];
}

export async function deliverRunResult(input: DeliveryInput, deps: DeliveryDeps = {}): Promise<DeliveryReport> {
  const channels = resolveDeliveryChannels(input.definition);
  if (channels.length === 0) return { status: "skipped", reason: "delivery-off", channels: {} };

  const href = `/dashboard/automation/runs/${input.runId}`;
  const siteUrl = deps.siteUrl ?? "https://www.algotraders24.ai";
  const msg = buildDeliveryMessage({
    automationName: input.automationName,
    briefs: input.agentOutputs.map((o) => composeAgentBrief(o)),
    href,
    siteUrl,
  });
  if (!msg) return { status: "skipped", reason: "nothing-to-report", channels: {} };

  const report: DeliveryReport = { status: "delivered", channels: {} };

  // A channel with no sender wired (deps omitted) reports false/0 - it is never
  // guessed at. Production wiring lives in delivery-deps.ts.
  if (channels.includes("bell")) {
    try {
      if (!deps.notify) throw new Error("no bell sender");
      await deps.notify({ userId: input.userId, kind: DELIVERY_NOTIFICATION_KIND, severity: "info", title: msg.title, body: msg.short, href });
      report.channels.bell = true;
    } catch {
      report.channels.bell = false;
    }
  }
  if (channels.includes("telegram")) {
    try {
      report.channels.telegram = deps.telegram ? await deps.telegram(input.userId, msg.telegramHtml) : false;
    } catch {
      report.channels.telegram = false;
    }
  }
  if (channels.includes("push")) {
    try {
      report.channels.push = deps.push
        ? await deps.push(input.userId, { title: msg.title, body: msg.short.slice(0, 160), url: href, tag: `automation-${input.automationId}` })
        : 0;
    } catch {
      report.channels.push = 0;
    }
  }
  return report;
}
