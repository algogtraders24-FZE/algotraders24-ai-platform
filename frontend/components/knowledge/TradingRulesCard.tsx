// components/knowledge/TradingRulesCard.tsx
// "My Trading Rules" - a guided form. Saving builds ONE markdown document (lib/knowledge/trading-rules.ts),
// indexes it in the user's Knowledge Base and replaces their previous rules document. Ask AI then
// answers with these rules in mind and shows the document as a source.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import { EMPTY_TRADING_RULES, validateTradingRules, type TradingRulesForm } from "@/lib/knowledge/trading-rules";

const STORAGE_KEY = "at24.tradingRulesDraft";

interface Props {
  saving: boolean;
  error: string | null;
  /** True when a "My Trading Rules" document is already saved. */
  hasSaved: boolean;
  onSave: (form: TradingRulesForm) => Promise<boolean> | boolean;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-text-2">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-3">{hint}</span>}
    </label>
  );
}

export default function TradingRulesCard({ saving, error, hasSaved, onSave }: Props) {
  const [form, setForm] = useState<TradingRulesForm>(EMPTY_TRADING_RULES);
  const [problems, setProblems] = useState<string[]>([]);
  const [savedNow, setSavedNow] = useState(false);

  // Per-device convenience only: the saved document itself lives in the Knowledge Base.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setForm({ ...EMPTY_TRADING_RULES, ...(JSON.parse(raw) as Partial<TradingRulesForm>) });
    } catch {
      /* storage unavailable - start empty */
    }
  }, []);

  const set = (key: keyof TradingRulesForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSavedNow(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const submit = async () => {
    const found = validateTradingRules(form);
    setProblems(found);
    if (found.length > 0) return;
    const ok = await onSave(form);
    if (ok) {
      setSavedNow(true);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Card padding="md" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text">My Trading Rules</h2>
        <p className="mt-1 text-sm text-text-2">
          Write your rules once. Ask AI will keep them in mind and tell you when it used them. Only what you type
          here is saved - nothing is added or changed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Risk per trade (%)">
          <Input inputMode="decimal" placeholder="e.g. 1" value={form.riskPerTradePct} onChange={set("riskPerTradePct")} />
        </Field>
        <Field label="Daily loss limit (%)">
          <Input inputMode="decimal" placeholder="e.g. 3" value={form.dailyLossPct} onChange={set("dailyLossPct")} />
        </Field>
        <Field label="Max drawdown (%)">
          <Input inputMode="decimal" placeholder="e.g. 8" value={form.maxDrawdownPct} onChange={set("maxDrawdownPct")} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Instruments I trade">
          <Input placeholder="e.g. XAUUSD, EURUSD" value={form.instruments} onChange={set("instruments")} />
        </Field>
        <Field label="Sessions / times I trade">
          <Input placeholder="e.g. London and New York only" value={form.sessions} onChange={set("sessions")} />
        </Field>
      </div>

      <Field label="When I do NOT trade" hint="High-impact news, Fridays after 18:00, after two losses in a row...">
        <Textarea rows={3} value={form.noTradeRules} onChange={set("noTradeRules")} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Prop firm (optional)">
          <Input placeholder="Firm name" value={form.propFirm} onChange={set("propFirm")} />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Its rules (paste from the firm's site)"
            hint="Rules change - the firm's own current terms are the only binding source."
          >
            <Textarea rows={3} value={form.propFirmRules} onChange={set("propFirmRules")} />
          </Field>
        </div>
      </div>

      <Field label="Anything else">
        <Textarea rows={2} value={form.otherRules} onChange={set("otherRules")} />
      </Field>

      {problems.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {savedNow && (
        <p className="text-xs text-success">
          Saved and indexed. <Link href="/dashboard/assistant" className="underline">Ask AI with your rules</Link>
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={submit} loading={saving}>
          {saving ? "Saving & indexing…" : hasSaved ? "Update my rules" : "Save my rules"}
        </Button>
        <span className="text-[11px] text-text-3">Saving replaces your previous rules document.</span>
      </div>
    </Card>
  );
}
