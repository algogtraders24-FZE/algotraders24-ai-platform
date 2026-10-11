"use client";

// components/automation/AutomationBuilder.tsx
// AT24 Automation - the guided builder, used to CREATE (/new) and to EDIT
// (/[id]/edit) an automation. It assembles a versioned workflow definition and
// sends it; the SERVER validates it, enforces plan limits and owns every
// decision after that. This component runs nothing and fakes no status.
// IST-only scheduling, the two locked slots, no arbitrary-time picker.
//
// Phase 2: a "Send me the result" section (bell / Telegram / push) and metric
// pickers that list the REAL fields each agent produces (regime confidence,
// bias, citations...) so a condition can actually be met. Built on the shared
// UI primitives (Card / Button / Input / Select / Textarea / Alert).
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  AutomationAgentType,
  AutomationConditionOp,
  AutomationDeliveryChannel,
  AutomationStep,
  AutomationTriggerType,
  AutomationWeekday,
  AutomationWorkflowDefinition,
} from "@/types/automation";
import { AutomationApi, AutomationApiError } from "@/services/api/AutomationApi";
import { WorkflowSequence } from "@/components/automation/ui";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Alert from "@/components/ui/Alert";

const SLOTS = [
  { id: "morning_ist", label: "Morning — 08:00 IST" },
  { id: "evening_ist", label: "Evening — 18:30 IST" },
] as const;
const WEEKDAYS: AutomationWeekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const TRIGGER_LABEL: Record<AutomationTriggerType, string> = {
  manual: "Only when I press Run now",
  once: "Once",
  daily: "Every day",
  weekly: "Selected weekdays",
};
const AGENT_TYPES: { id: AutomationAgentType; label: string }[] = [
  { id: "MARKET_INTELLIGENCE", label: "Market Intelligence (bias, regime, reasons)" },
  { id: "RESEARCH", label: "Research (your knowledge base + news)" },
  { id: "STRATEGY_RESEARCH", label: "Strategy Research (backtest-backed)" },
];
const CATEGORY_LABEL: Record<string, string> = {
  "technical-analysis": "Technical Analysis",
  "fundamental-analysis": "Fundamental Analysis",
  "market-outlook": "Market Outlook",
  "economic-preview": "Economic Preview",
  "forex-analysis": "Forex Analysis",
  "gold-analysis": "Gold Analysis",
  "crypto-analysis": "Crypto Analysis",
  "index-analysis": "Index Analysis",
  "weekly-review": "Weekly Review",
};
const OPS: { id: AutomationConditionOp; label: string }[] = [
  { id: "gte", label: "is at least (≥)" },
  { id: "gt", label: "is more than (>)" },
  { id: "lte", label: "is at most (≤)" },
  { id: "lt", label: "is less than (<)" },
  { id: "eq", label: "equals (=)" },
  { id: "neq", label: "does not equal (≠)" },
];

/** The real, top-level fields each agent's output carries - what a condition can test. */
export const AGENT_METRICS: Record<AutomationAgentType, { field: string; label: string }[]> = {
  MARKET_INTELLIGENCE: [
    { field: "regimeConfidence", label: "Regime confidence (0–100)" },
    { field: "bias", label: "Bias (bullish-leaning / bearish-leaning / neutral)" },
    { field: "regimeType", label: "Regime type" },
    { field: "hypothesisCount", label: "Number of hypotheses" },
  ],
  RESEARCH: [
    { field: "citationCount", label: "Number of sources found" },
    { field: "knowledgeHits", label: "Knowledge-base hits" },
    { field: "newsHits", label: "News hits" },
    { field: "coverage", label: "Coverage" },
  ],
  STRATEGY_RESEARCH: [{ field: "supportsFurtherResearch", label: "Supports further research (true/false)" }],
};

export interface Draft {
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  slot: string;
  daysOfWeek: AutomationWeekday[];
  runAt: string;
  steps: AutomationStep[];
  channels: AutomationDeliveryChannel[];
}

export const emptyDraft: Draft = {
  name: "",
  description: "",
  triggerType: "manual",
  slot: "morning_ist",
  daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
  runAt: "",
  steps: [],
  channels: ["bell"],
};

/** Server definition -> editable draft (edit mode). */
export function definitionToDraft(name: string, description: string, def: AutomationWorkflowDefinition): Draft {
  return {
    name,
    description,
    triggerType: def.trigger.type,
    slot: def.trigger.slot ?? "morning_ist",
    daysOfWeek: def.trigger.daysOfWeek ?? ["MON", "TUE", "WED", "THU", "FRI"],
    runAt: def.trigger.runAt ? def.trigger.runAt.slice(0, 10) : "",
    steps: def.steps,
    channels: def.delivery ? def.delivery.channels : ["bell"],
  };
}

/** Draft -> the definition the server validates. */
export function buildDefinition(d: Draft): AutomationWorkflowDefinition {
  const trigger: AutomationWorkflowDefinition["trigger"] = { type: d.triggerType, timezone: "Asia/Kolkata" };
  if (d.triggerType !== "manual") trigger.slot = d.slot;
  if (d.triggerType === "weekly") trigger.daysOfWeek = d.daysOfWeek;
  if (d.triggerType === "once" && d.runAt) trigger.runAt = new Date(d.runAt + "T00:00:00.000Z").toISOString();
  return { schemaVersion: 1, trigger, steps: d.steps, delivery: { channels: d.channels } };
}

type AgentStep = Extract<AutomationStep, { kind: "agent_run" }>;
const isAgent = (s: AutomationStep): s is AgentStep => s.kind === "agent_run";

function defaultStep(kind: AutomationStep["kind"], id: string, prior: AutomationStep[]): AutomationStep {
  const agents = prior.filter(isAgent);
  const source = agents.find((a) => a.action.agentType === "MARKET_INTELLIGENCE") ?? agents[agents.length - 1];
  if (kind === "agent_run") return { id, kind, action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } } };
  if (kind === "condition") {
    const left = source ? `$.steps.${source.id}.${AGENT_METRICS[source.action.agentType][0].field}` : "";
    return { id, kind, condition: { left, op: "gte", right: 70 } };
  }
  if (kind === "publication_draft") {
    return { id, kind, action: { category: "market-outlook", ...(source ? { aiOverviewFrom: `$.steps.${source.id}.briefText` } : {}) } };
  }
  return { id, kind, action: { title: "Automation result", from: source ? `$.steps.${source.id}.result` : "$.trigger.firedAt" } };
}

interface ChannelStatus {
  telegram: { configured: boolean; linked: boolean; username: string | null } | null;
  push: { configured: boolean; devices: number } | null;
}

async function loadChannelStatus(): Promise<ChannelStatus> {
  const get = async (url: string): Promise<Record<string, unknown> | null> => {
    try {
      const r = await fetch(url);
      const j = (await r.json()) as { status?: string; data?: Record<string, unknown> };
      return j.status === "ok" ? (j.data ?? null) : null;
    } catch {
      return null;
    }
  };
  const [tg, pu] = await Promise.all([get("/api/private/telegram"), get("/api/private/push")]);
  return {
    telegram: tg ? { configured: tg.configured === true, linked: tg.linked === true, username: typeof tg.username === "string" ? tg.username : null } : null,
    push: pu ? { configured: pu.configured === true, devices: typeof pu.devices === "number" ? pu.devices : 0 } : null,
  };
}

export function AutomationBuilder({
  mode,
  automationId,
  initial,
  onBack,
}: {
  mode: "create" | "edit";
  automationId?: string;
  initial: Draft;
  onBack?: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [channels, setChannels] = useState<ChannelStatus | null>(null);

  useEffect(() => {
    let live = true;
    loadChannelStatus().then((s) => live && setChannels(s));
    return () => {
      live = false;
    };
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const definition = useMemo(() => buildDefinition(draft), [draft]);

  async function submit(activate: boolean) {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      let id = automationId ?? "";
      const payload = { name: draft.name.trim() || "Untitled automation", description: draft.description.trim(), definition };
      if (mode === "create") {
        const created = await AutomationApi.create(payload);
        id = created.id;
        if (activate) await AutomationApi.transition(id, "activate").catch(() => undefined);
      } else {
        await AutomationApi.update(id, payload);
      }
      router.push(`/dashboard/automation/${id}`);
    } catch (e) {
      if (e instanceof AutomationApiError && e.code === "VALIDATION_ERROR" && e.details && typeof e.details === "object") {
        setIssues((e.details as { issues?: { path: string; message: string }[] }).issues ?? []);
        setError("The workflow needs a few fixes before it can be saved.");
      } else {
        setError(e instanceof Error ? e.message : "Could not save the automation");
      }
      setBusy(false);
    }
  }

  const toggleChannel = (c: AutomationDeliveryChannel) =>
    set("channels", draft.channels.includes(c) ? draft.channels.filter((x) => x !== c) : [...draft.channels, c]);

  return (
    <div className="space-y-5">
      {onBack && (
        <button onClick={onBack} className="text-xs text-text-3 hover:text-text">
          ← back
        </button>
      )}

      {error && (
        <Alert tone="danger">
          {error}
          {issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {issues.map((i, n) => (
                <li key={n}>
                  <code className="text-danger/80">{i.path}</code> — {i.message}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-text-2">1 · Basic information</h2>
        <Input placeholder="Automation name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        <Textarea className="min-h-[64px]" placeholder="Description (optional)" value={draft.description} onChange={(e) => set("description", e.target.value)} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-text-2">2 · When should it run?</h2>
        <div className="flex flex-wrap gap-2">
          {(["manual", "once", "daily", "weekly"] as AutomationTriggerType[]).map((t) => (
            <Button key={t} size="sm" variant={draft.triggerType === t ? "primary" : "secondary"} onClick={() => set("triggerType", t)}>
              {TRIGGER_LABEL[t]}
            </Button>
          ))}
        </div>
        {draft.triggerType !== "manual" && (
          <>
            <p className="text-xs text-text-3">
              Scheduled automations run on <strong>India Standard Time</strong>. Pick a time:
            </p>
            <div className="flex flex-wrap gap-2">
              {SLOTS.map((s) => (
                <Button key={s.id} size="sm" variant={draft.slot === s.id ? "primary" : "secondary"} onClick={() => set("slot", s.id)}>
                  {s.label}
                </Button>
              ))}
            </div>
          </>
        )}
        {draft.triggerType === "weekly" && (
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => {
              const on = draft.daysOfWeek.includes(d);
              return (
                <Button key={d} size="sm" variant={on ? "primary" : "secondary"} onClick={() => set("daysOfWeek", on ? draft.daysOfWeek.filter((x) => x !== d) : [...draft.daysOfWeek, d])}>
                  {d}
                </Button>
              );
            })}
          </div>
        )}
        {draft.triggerType === "once" && (
          <label className="block text-xs text-text-3">
            Run on/after
            <Input type="date" className="mt-1" value={draft.runAt} onChange={(e) => set("runAt", e.target.value)} />
          </label>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-text-2">3 · What should it do?</h2>
        <StepEditor steps={draft.steps} onChange={(steps) => set("steps", steps)} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-text-2">4 · Send me the result</h2>
        <p className="text-xs text-text-3">
          When a run completes and has something to report, it is sent here. A run that stops on your condition, or has nothing useful to say, sends nothing.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.channels.includes("bell")} onChange={() => toggleChannel("bell")} />
          In-app notification (the bell)
        </label>
        <ChannelOption
          label="Telegram"
          checked={draft.channels.includes("telegram")}
          onToggle={() => toggleChannel("telegram")}
          status={channels?.telegram ? (!channels.telegram.configured ? "Not available yet" : channels.telegram.linked ? `Connected${channels.telegram.username ? ` as @${channels.telegram.username}` : ""}` : "Not connected yet") : "…"}
          ok={channels?.telegram?.linked === true}
        />
        <ChannelOption
          label="Phone / browser push"
          checked={draft.channels.includes("push")}
          onToggle={() => toggleChannel("push")}
          status={channels?.push ? (!channels.push.configured ? "Not available yet" : channels.push.devices > 0 ? `${channels.push.devices} device${channels.push.devices === 1 ? "" : "s"} enabled` : "No device enabled yet") : "…"}
          ok={(channels?.push?.devices ?? 0) > 0}
        />
        <p className="text-xs text-text-3">
          Connect Telegram or enable push in{" "}
          <Link href="/dashboard/live-sync" className="text-gold hover:underline">
            Live Sync
          </Link>
          . Until you do, those options simply do nothing.
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-text-2">5 · Review</h2>
        <div className="rounded-control border border-border bg-ink p-3">
          <WorkflowSequence def={definition} />
        </div>
        {mode === "edit" && <p className="text-xs text-text-3">Saving creates a new version. Runs that already happened keep the version they ran on.</p>}
        <div className="flex gap-2">
          {mode === "create" ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => submit(false)}>
                Save as draft
              </Button>
              <Button loading={busy} onClick={() => submit(true)}>
                Create &amp; activate
              </Button>
            </>
          ) : (
            <>
              <Button loading={busy} onClick={() => submit(false)}>
                Save changes
              </Button>
              <ButtonLink variant="secondary" href={`/dashboard/automation/${automationId}`}>
                Cancel
              </ButtonLink>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function ChannelOption({ label, checked, onToggle, status, ok }: { label: string; checked: boolean; onToggle: () => void; status: string; ok: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {label}
      </span>
      <span className={`text-xs ${ok ? "text-success" : "text-text-3"}`}>{status}</span>
    </label>
  );
}

const STEP_NAME: Record<AutomationStep["kind"], string> = {
  agent_run: "Run an agent",
  condition: "Only continue if…",
  workspace_save: "Save the result",
  publication_draft: "Create a publication draft",
};

function StepEditor({ steps, onChange }: { steps: AutomationStep[]; onChange: (s: AutomationStep[]) => void }) {
  const nextId = () => {
    for (let i = 1; i < 99; i++) if (!steps.some((s) => s.id === `s${i}`)) return `s${i}`;
    return `s${steps.length + 1}`;
  };
  const add = (kind: AutomationStep["kind"]) => onChange([...steps, defaultStep(kind, nextId(), steps)]);
  const update = (idx: number, s: AutomationStep) => onChange(steps.map((x, i) => (i === idx ? s : x)));
  const remove = (idx: number) => onChange(steps.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return;
    const copy = [...steps];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    onChange(copy);
  };

  return (
    <div className="space-y-2">
      {steps.length === 0 && <p className="text-xs text-text-3">Add the first step - usually an agent (Market Intelligence is a good start).</p>}
      {steps.map((s, i) => (
        <div key={s.id} className="rounded-control border border-border bg-ink-3 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-2">
              {s.id} · {STEP_NAME[s.kind]}
            </span>
            <div className="flex gap-1 text-xs">
              <button onClick={() => move(i, -1)} className="px-1 text-text-3 hover:text-text" aria-label="Move up">↑</button>
              <button onClick={() => move(i, 1)} className="px-1 text-text-3 hover:text-text" aria-label="Move down">↓</button>
              <button onClick={() => remove(i)} className="px-1 text-danger/80 hover:text-danger" aria-label="Remove step">✕</button>
            </div>
          </div>
          <StepFields step={s} priorAgents={steps.slice(0, i).filter(isAgent)} onChange={(ns) => update(i, ns)} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={() => add("agent_run")}>+ Run an agent</Button>
        <Button size="sm" variant="secondary" onClick={() => add("condition")}>+ Only continue if…</Button>
        <Button size="sm" variant="secondary" onClick={() => add("workspace_save")}>+ Save the result</Button>
        <Button size="sm" variant="secondary" onClick={() => add("publication_draft")}>+ Create a publication draft</Button>
      </div>
    </div>
  );
}

function StepFields({ step, priorAgents, onChange }: { step: AutomationStep; priorAgents: AgentStep[]; onChange: (s: AutomationStep) => void }) {
  if (step.kind === "agent_run") {
    const symbol = typeof step.action.input.symbol === "string" ? step.action.input.symbol : "";
    const question = typeof step.action.input.question === "string" ? step.action.input.question : "";
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={step.action.agentType} onChange={(e) => onChange({ ...step, action: { ...step.action, agentType: e.target.value as AutomationAgentType } })}>
          {AGENT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </Select>
        <Input
          placeholder="Instrument (e.g. XAUUSD)"
          value={symbol}
          onChange={(e) => onChange({ ...step, action: { ...step.action, input: { ...step.action.input, symbol: e.target.value } } })}
        />
        {step.action.agentType === "RESEARCH" && (
          <Input
            className="sm:col-span-2"
            placeholder="What should it research? (e.g. gold ETF flows)"
            value={question}
            onChange={(e) => onChange({ ...step, action: { ...step.action, input: { ...step.action.input, question: e.target.value } } })}
          />
        )}
      </div>
    );
  }

  if (step.kind === "condition") {
    if (priorAgents.length === 0) return <p className="text-xs text-warn">Add an agent step before this one - a condition needs a result to look at.</p>;
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={step.condition.left} onChange={(e) => onChange({ ...step, condition: { ...step.condition, left: e.target.value } })}>
          <option value="">— what to check —</option>
          {priorAgents.flatMap((a) =>
            AGENT_METRICS[a.action.agentType].map((m) => (
              <option key={`${a.id}.${m.field}`} value={`$.steps.${a.id}.${m.field}`}>
                {a.id}: {m.label}
              </option>
            )),
          )}
        </Select>
        <Select value={step.condition.op} onChange={(e) => onChange({ ...step, condition: { ...step.condition, op: e.target.value as AutomationConditionOp } })}>
          {OPS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </Select>
        <Input
          placeholder="value (e.g. 70, bullish-leaning, true)"
          value={String(step.condition.right)}
          onChange={(e) => {
            const raw = e.target.value;
            const n = Number(raw);
            onChange({ ...step, condition: { ...step.condition, right: raw === "true" ? true : raw === "false" ? false : raw !== "" && !Number.isNaN(n) ? n : raw } });
          }}
        />
      </div>
    );
  }

  if (step.kind === "publication_draft") {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={step.action.category} onChange={(e) => onChange({ ...step, action: { ...step.action, category: e.target.value } })}>
          {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </Select>
        <Select
          value={step.action.aiOverviewFrom ?? ""}
          onChange={(e) => {
            const rest = { ...step.action };
            delete rest.aiOverviewFrom;
            onChange({ ...step, action: e.target.value ? { ...rest, aiOverviewFrom: e.target.value } : rest });
          }}
        >
          <option value="">Draft skeleton only</option>
          {priorAgents.map((a) => (
            <option key={a.id} value={`$.steps.${a.id}.briefText`}>
              Use the findings of {a.id}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  // workspace_save
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Input placeholder="Result title" value={step.action.title} onChange={(e) => onChange({ ...step, action: { ...step.action, title: e.target.value } })} />
      <Select value={step.action.from} onChange={(e) => onChange({ ...step, action: { ...step.action, from: e.target.value } })}>
        {priorAgents.length === 0 && <option value={step.action.from}>(add an agent step first)</option>}
        {priorAgents.map((a) => (
          <option key={a.id} value={`$.steps.${a.id}.result`}>
            Save the result of {a.id}
          </option>
        ))}
      </Select>
    </div>
  );
}
