"use client";

// app/dashboard/automation/new - AT24 Automation (MVP) guided builder.
// LOCKED: AUTOMATION_DECISION_LOCK.md. The builder assembles a versioned
// workflow definition and POSTs it; the SERVER validates it (Workflow
// Validator), enforces plan limits and owns every downstream decision. This
// component never runs anything or fakes a status. IST-only scheduling, the
// two locked slots, no "Workflow" naming, no arbitrary-time picker.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  AutomationAgentType,
  AutomationConditionOp,
  AutomationStep,
  AutomationTriggerType,
  AutomationWeekday,
  AutomationWorkflowDefinition,
} from "@/types/automation";
import { AutomationApi, AutomationApiError, type TemplateSummary } from "@/services/api/AutomationApi";
import { WorkflowSequence } from "@/components/automation/ui";

const SLOTS = [
  { id: "morning_ist", label: "Morning — 08:00 IST" },
  { id: "evening_ist", label: "Evening — 18:30 IST" },
] as const;
const WEEKDAYS: AutomationWeekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const AGENT_TYPES: AutomationAgentType[] = ["MARKET_INTELLIGENCE", "RESEARCH", "STRATEGY_RESEARCH"];
const CATEGORIES = [
  "technical-analysis", "fundamental-analysis", "market-outlook", "economic-preview",
  "forex-analysis", "gold-analysis", "crypto-analysis", "index-analysis", "weekly-review",
];
const OPS: AutomationConditionOp[] = ["gte", "gt", "lte", "lt", "eq", "neq"];

const btn = "rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-40";
const btnGold = `${btn} border-gold bg-gold/10 text-gold hover:bg-gold/20`;
const btnGhost = `${btn} border-border text-text-2 hover:bg-ink-3`;
const field = "w-full rounded-lg border border-border bg-ink px-3 py-2 text-sm text-text outline-none focus:border-gold";

type Draft = {
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  slot: string;
  daysOfWeek: AutomationWeekday[];
  runAt: string;
  steps: AutomationStep[];
};

const emptyDraft: Draft = {
  name: "",
  description: "",
  triggerType: "manual",
  slot: "morning_ist",
  daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
  runAt: "",
  steps: [],
};

export default function NewAutomationPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"choose" | "template" | "scratch">("choose");
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);

  useEffect(() => {
    AutomationApi.templates().then((d) => setTemplates(d.items)).catch(() => setTemplates([]));
  }, []);

  const definition = useMemo<AutomationWorkflowDefinition>(() => buildDefinition(draft), [draft]);

  async function submit(activate: boolean) {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const created = await AutomationApi.create({
        name: draft.name.trim() || "Untitled automation",
        description: draft.description.trim(),
        definition,
      });
      if (activate) {
        await AutomationApi.transition(created.id, "activate").catch(() => {
          /* leave as DRAFT; detail page shows why */
        });
      }
      router.push(`/dashboard/automation/${created.id}`);
    } catch (e) {
      if (e instanceof AutomationApiError && e.code === "VALIDATION_ERROR" && e.details && typeof e.details === "object") {
        const list = (e.details as { issues?: { path: string; message: string }[] }).issues ?? [];
        setIssues(list);
        setError("The definition needs a few fixes before it can be saved.");
      } else {
        setError(e instanceof Error ? e.message : "Could not create the automation");
      }
      setBusy(false);
    }
  }

  async function useTemplate(t: TemplateSummary, symbol: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const created = await AutomationApi.fromTemplate({
        templateId: t.id,
        overrides: { name: name.trim() || t.name, symbol: symbol.trim() || undefined },
      });
      router.push(`/dashboard/automation/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create from template");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Create automation</h1>
          <Link href="/dashboard/automation" className="text-sm text-text-3 hover:text-text">
            Cancel
          </Link>
        </header>

        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
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
          </div>
        )}

        {mode === "choose" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <button className={`${btnGhost} h-32 flex-col text-left`} onClick={() => setMode("template")}>
              <span className="text-base font-semibold text-text">Start from a template</span>
              <span className="mt-1 block text-xs text-text-3">Daily Market Brief · Gold Morning Intelligence · Research Monitor</span>
            </button>
            <button className={`${btnGhost} h-32 flex-col text-left`} onClick={() => setMode("scratch")}>
              <span className="text-base font-semibold text-text">Build from scratch</span>
              <span className="mt-1 block text-xs text-text-3">Choose a trigger, add steps, add an optional condition</span>
            </button>
          </div>
        )}

        {mode === "template" && (
          <TemplatePicker templates={templates} busy={busy} onBack={() => setMode("choose")} onUse={useTemplate} />
        )}

        {mode === "scratch" && (
          <ScratchBuilder
            draft={draft}
            setDraft={setDraft}
            definition={definition}
            busy={busy}
            onBack={() => setMode("choose")}
            onSubmit={submit}
          />
        )}
      </div>
    </div>
  );
}

// ── template flow ────────────────────────────────────────────────────────

function TemplatePicker({
  templates,
  busy,
  onBack,
  onUse,
}: {
  templates: TemplateSummary[] | null;
  busy: boolean;
  onBack: () => void;
  onUse: (t: TemplateSummary, symbol: string, name: string) => void;
}) {
  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [name, setName] = useState("");

  if (!templates) return <p className="text-sm text-text-3">Loading templates…</p>;

  if (selected) {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-ink-2 p-5">
        <button onClick={() => setSelected(null)} className="text-xs text-text-3 hover:text-text">
          ← other templates
        </button>
        <h2 className="text-lg font-semibold">{selected.name}</h2>
        <p className="text-sm text-text-3">{selected.description}</p>
        <label className="block text-xs text-text-3">
          Name
          <input className={`${field} mt-1`} value={name} placeholder={selected.name} onChange={(e) => setName(e.target.value)} />
        </label>
        {selected.overridable.includes("symbol") && (
          <label className="block text-xs text-text-3">
            Instrument
            <input className={`${field} mt-1`} value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </label>
        )}
        <div className="rounded-lg border border-border bg-ink p-3">
          <WorkflowSequence def={selected.definition} />
        </div>
        <button className={btnGold} disabled={busy} onClick={() => onUse(selected, symbol, name)}>
          {busy ? "Creating…" : "Create as draft"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-text-3 hover:text-text">
        ← back
      </button>
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => setSelected(t)}
          className="block w-full rounded-xl border border-border bg-ink-2 p-4 text-left hover:border-gold/50"
        >
          <p className="font-semibold text-text">{t.name}</p>
          <p className="mt-1 text-xs text-text-3">{t.description}</p>
        </button>
      ))}
    </div>
  );
}

// ── scratch flow ─────────────────────────────────────────────────────────

function ScratchBuilder({
  draft,
  setDraft,
  definition,
  busy,
  onBack,
  onSubmit,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  definition: AutomationWorkflowDefinition;
  busy: boolean;
  onBack: () => void;
  onSubmit: (activate: boolean) => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const priorAgentIds = draft.steps.filter((s) => s.kind === "agent_run").map((s) => s.id);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-text-3 hover:text-text">
        ← back
      </button>

      <section className="space-y-3 rounded-xl border border-border bg-ink-2 p-5">
        <h2 className="text-sm font-semibold text-text-2">1 · Basic information</h2>
        <input className={field} placeholder="Automation name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        <textarea
          className={`${field} min-h-[64px]`}
          placeholder="Description (optional)"
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-ink-2 p-5">
        <h2 className="text-sm font-semibold text-text-2">2 · Trigger</h2>
        <div className="flex flex-wrap gap-2">
          {(["manual", "once", "daily", "weekly"] as AutomationTriggerType[]).map((t) => (
            <button
              key={t}
              onClick={() => set("triggerType", t)}
              className={`${btn} ${draft.triggerType === t ? "border-gold bg-gold/10 text-gold" : "border-border text-text-2 hover:bg-ink-3"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {draft.triggerType !== "manual" && (
          <>
            <p className="text-xs text-text-3">
              Scheduled automations run on <strong>India Standard Time</strong>. Pick a slot:
            </p>
            <div className="flex flex-wrap gap-2">
              {SLOTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => set("slot", s.id)}
                  className={`${btn} ${draft.slot === s.id ? "border-gold bg-gold/10 text-gold" : "border-border text-text-2 hover:bg-ink-3"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
        {draft.triggerType === "weekly" && (
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => {
              const on = draft.daysOfWeek.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => set("daysOfWeek", on ? draft.daysOfWeek.filter((x) => x !== d) : [...draft.daysOfWeek, d])}
                  className={`${btn} px-2.5 ${on ? "border-gold bg-gold/10 text-gold" : "border-border text-text-3 hover:bg-ink-3"}`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
        {draft.triggerType === "once" && (
          <label className="block text-xs text-text-3">
            Run on/after
            <input type="date" className={`${field} mt-1`} value={draft.runAt} onChange={(e) => set("runAt", e.target.value)} />
          </label>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-ink-2 p-5">
        <h2 className="text-sm font-semibold text-text-2">3 · Steps</h2>
        <StepEditor steps={draft.steps} priorAgentIds={priorAgentIds} onChange={(steps) => set("steps", steps)} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-ink-2 p-5">
        <h2 className="text-sm font-semibold text-text-2">4 · Review</h2>
        <div className="rounded-lg border border-border bg-ink p-3">
          <WorkflowSequence def={definition} />
        </div>
        <div className="flex gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => onSubmit(false)}>
            Save as draft
          </button>
          <button className={btnGold} disabled={busy} onClick={() => onSubmit(true)}>
            {busy ? "Creating…" : "Create & activate"}
          </button>
        </div>
      </section>
    </div>
  );
}

function StepEditor({
  steps,
  priorAgentIds,
  onChange,
}: {
  steps: AutomationStep[];
  priorAgentIds: string[];
  onChange: (s: AutomationStep[]) => void;
}) {
  const nextId = () => {
    for (let i = 1; i < 99; i++) if (!steps.some((s) => s.id === `s${i}`)) return `s${i}`;
    return `s${steps.length + 1}`;
  };
  const add = (kind: AutomationStep["kind"]) => onChange([...steps, defaultStep(kind, nextId())]);
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
      {steps.map((s, i) => (
        <div key={s.id} className="rounded-lg border border-border bg-ink-3 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-2">
              {s.id} · {s.kind}
            </span>
            <div className="flex gap-1 text-xs">
              <button onClick={() => move(i, -1)} className="px-1 text-text-3 hover:text-text">↑</button>
              <button onClick={() => move(i, 1)} className="px-1 text-text-3 hover:text-text">↓</button>
              <button onClick={() => remove(i)} className="px-1 text-danger/80 hover:text-danger">✕</button>
            </div>
          </div>
          <StepFields step={s} priorAgentIds={priorAgentIds} onChange={(ns) => update(i, ns)} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button className={`${btnGhost} text-xs`} onClick={() => add("agent_run")}>+ Agent</button>
        <button className={`${btnGhost} text-xs`} onClick={() => add("condition")}>+ Condition</button>
        <button className={`${btnGhost} text-xs`} onClick={() => add("publication_draft")}>+ Publication draft</button>
        <button className={`${btnGhost} text-xs`} onClick={() => add("workspace_save")}>+ Save to Workspace</button>
      </div>
    </div>
  );
}

function StepFields({
  step,
  priorAgentIds,
  onChange,
}: {
  step: AutomationStep;
  priorAgentIds: string[];
  onChange: (s: AutomationStep) => void;
}) {
  if (step.kind === "agent_run") {
    const symbol = typeof step.action.input.symbol === "string" ? step.action.input.symbol : "";
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          className={field}
          value={step.action.agentType}
          onChange={(e) => onChange({ ...step, action: { ...step.action, agentType: e.target.value as AutomationAgentType } })}
        >
          {AGENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          className={field}
          placeholder="symbol (e.g. XAUUSD)"
          value={symbol}
          onChange={(e) => onChange({ ...step, action: { ...step.action, input: { ...step.action.input, symbol: e.target.value } } })}
        />
      </div>
    );
  }
  if (step.kind === "condition") {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          className={field}
          value={step.condition.left}
          onChange={(e) => onChange({ ...step, condition: { ...step.condition, left: e.target.value } })}
        >
          <option value="">— metric —</option>
          {priorAgentIds.flatMap((id) =>
            ["confidence", "status"].map((f) => (
              <option key={`${id}.${f}`} value={`$.steps.${id}.${f}`}>{id}.{f}</option>
            )),
          )}
        </select>
        <select
          className={field}
          value={step.condition.op}
          onChange={(e) => onChange({ ...step, condition: { ...step.condition, op: e.target.value as AutomationConditionOp } })}
        >
          {OPS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <input
          className={field}
          placeholder="value (e.g. 0.75)"
          value={String(step.condition.right)}
          onChange={(e) => {
            const raw = e.target.value;
            const n = Number(raw);
            onChange({ ...step, condition: { ...step.condition, right: raw !== "" && !Number.isNaN(n) ? n : raw } });
          }}
        />
      </div>
    );
  }
  if (step.kind === "publication_draft") {
    return (
      <select
        className={field}
        value={step.action.category}
        onChange={(e) => onChange({ ...step, action: { ...step.action, category: e.target.value } })}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={field}
      placeholder="Result title"
      value={step.action.title}
      onChange={(e) => onChange({ ...step, action: { ...step.action, title: e.target.value } })}
    />
  );
}

// ── draft -> definition ──────────────────────────────────────────────────

function defaultStep(kind: AutomationStep["kind"], id: string): AutomationStep {
  if (kind === "agent_run") return { id, kind, action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD" } } };
  if (kind === "condition") return { id, kind, condition: { left: "", op: "gte", right: 0.75 } };
  if (kind === "publication_draft") return { id, kind, action: { category: "market-outlook" } };
  return { id, kind, action: { title: "Automation result", from: "$.trigger.firedAt" } };
}

function buildDefinition(d: Draft): AutomationWorkflowDefinition {
  const trigger: AutomationWorkflowDefinition["trigger"] = { type: d.triggerType, timezone: "Asia/Kolkata" };
  if (d.triggerType !== "manual") trigger.slot = d.slot;
  if (d.triggerType === "weekly") trigger.daysOfWeek = d.daysOfWeek;
  if (d.triggerType === "once" && d.runAt) trigger.runAt = new Date(d.runAt + "T00:00:00.000Z").toISOString();

  // wire workspace_save/publication_draft to the last agent_run result if the
  // author left the default source
  const lastAgent = [...d.steps].reverse().find((s) => s.kind === "agent_run");
  const steps = d.steps.map((s) => {
    if (s.kind === "workspace_save" && s.action.from === "$.trigger.firedAt" && lastAgent) {
      return { ...s, action: { ...s.action, from: `$.steps.${lastAgent.id}.result` } };
    }
    if (s.kind === "publication_draft" && !s.action.aiOverviewFrom && lastAgent) {
      return { ...s, action: { ...s.action, aiOverviewFrom: `$.steps.${lastAgent.id}.summary` } };
    }
    return s;
  });

  return { schemaVersion: 1, trigger, steps };
}
