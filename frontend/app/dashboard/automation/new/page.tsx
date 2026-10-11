"use client";

// app/dashboard/automation/new - AT24 Automation: create.
// Two ways in: start from a ready template (one click, symbol/name override)
// or build from scratch with the guided builder. The SERVER validates and owns
// every decision; this page runs nothing. Built on the shared UI primitives.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AutomationApi, type TemplateSummary } from "@/services/api/AutomationApi";
import { WorkflowSequence } from "@/components/automation/ui";
import { AutomationBuilder, emptyDraft } from "@/components/automation/AutomationBuilder";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Alert from "@/components/ui/Alert";

const CHOICE = "flex h-32 flex-col justify-center rounded-card border border-border bg-ink-2 p-4 text-left text-text-2 transition hover:border-gold/50";

export default function NewAutomationPage() {
  const [mode, setMode] = useState<"choose" | "template" | "scratch">("choose");

  // The empty state links here with ?mode=template to skip the first choice.
  // Read from window (not useSearchParams) so the page needs no Suspense boundary.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "template") setMode("template");
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Create automation"
        action={
          <Link href="/dashboard/automation" className="text-sm text-text-3 hover:text-text">
            Cancel
          </Link>
        }
      />

      {mode === "choose" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <button className={CHOICE} onClick={() => setMode("template")}>
            <span className="text-base font-semibold text-text">Start from a template</span>
            <span className="mt-1 block text-xs text-text-3">Ready-made, one click. Daily Market Brief · Gold Morning Intelligence · Evening Outlook Draft</span>
          </button>
          <button className={CHOICE} onClick={() => setMode("scratch")}>
            <span className="text-base font-semibold text-text">Build from scratch</span>
            <span className="mt-1 block text-xs text-text-3">Choose when it runs, what it does, and where the result is sent</span>
          </button>
        </div>
      )}

      {mode === "template" && <TemplatePicker onBack={() => setMode("choose")} />}
      {mode === "scratch" && <AutomationBuilder mode="create" initial={emptyDraft} onBack={() => setMode("choose")} />}
    </div>
  );
}

function TemplatePicker({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [symbol, setSymbol] = useState("XAUUSD");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AutomationApi.templates().then((d) => setTemplates(d.items)).catch(() => setTemplates([]));
  }, []);

  async function create(activate: boolean) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const created = await AutomationApi.fromTemplate({
        templateId: selected.id,
        overrides: { name: name.trim() || selected.name, symbol: symbol.trim() || undefined },
      });
      if (activate) await AutomationApi.transition(created.id, "activate").catch(() => undefined);
      router.push(`/dashboard/automation/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create from template");
      setBusy(false);
    }
  }

  if (!templates) return <p className="text-sm text-text-3">Loading templates…</p>;

  if (selected) {
    return (
      <Card className="space-y-4">
        <button onClick={() => setSelected(null)} className="text-xs text-text-3 hover:text-text">
          ← other templates
        </button>
        <h2 className="text-lg font-semibold">{selected.name}</h2>
        <p className="text-sm text-text-3">{selected.description}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <label className="block text-xs text-text-3">
          Name
          <Input className="mt-1" value={name} placeholder={selected.name} onChange={(e) => setName(e.target.value)} />
        </label>
        {selected.overridable.includes("symbol") && (
          <label className="block text-xs text-text-3">
            Instrument
            <Input className="mt-1" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </label>
        )}
        <div className="rounded-control border border-border bg-ink p-3">
          <WorkflowSequence def={selected.definition} />
        </div>
        <p className="text-xs text-text-3">Results go to your in-app bell, and to Telegram / phone push if you have connected them. You can change this later with Edit.</p>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => create(false)}>
            Save as draft
          </Button>
          <Button loading={busy} onClick={() => create(true)}>
            Create &amp; activate
          </Button>
        </div>
      </Card>
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
          className="block w-full rounded-card border border-border bg-ink-2 p-4 text-left transition hover:border-gold/50"
        >
          <p className="font-semibold text-text">{t.name}</p>
          <p className="mt-1 text-xs text-text-3">{t.description}</p>
        </button>
      ))}
    </div>
  );
}
