"use client";

// app/dashboard/alerts/page.tsx
// Market alerts: pick what you want to be told about, per instrument. Three kinds, none of them a trade call:
// price near yesterday's high / low, volatility turning high, a high-impact event minutes away. Delivered to the bell,
// and to Telegram / push when connected. Every switch saves immediately (PUT) and the server re-arms that rule.
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Skeleton from "@/components/ui/Skeleton";
import ErrorState from "@/components/ui/ErrorState";
import Disclaimer from "@/components/ui/Disclaimer";
import PageHeader from "@/components/ui/PageHeader";

interface KindInfo {
  kind: string;
  label: string;
  unit: string;
  help: string;
  options: number[] | null;
  defaultThreshold: number;
}
interface RuleView {
  kind: string;
  enabled: boolean;
  threshold: number;
  state: string;
}
interface SymbolView {
  symbol: string;
  label: string;
  rules: RuleView[];
}
interface Payload {
  kinds: KindInfo[];
  symbols: SymbolView[];
}

type LoadState = "loading" | "ready" | "error";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as { status: "ok"; data: T } | { status: "error"; error: { message: string } } | null;
  if (!json || json.status !== "ok") throw new Error(json && json.status === "error" ? json.error.message : `Request failed (${res.status})`);
  return json.data;
}

export default function AlertsPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setState("loading");
    api<Payload>("/api/private/market-alerts")
      .then((d) => {
        setData(d);
        setState("ready");
      })
      .catch((e: Error) => {
        setError(e.message);
        setState("error");
      });
  }, []);
  useEffect(load, [load]);

  async function save(symbol: string, kind: string, enabled: boolean, threshold: number) {
    const key = `${symbol}:${kind}`;
    setSaving(key);
    setData((d) => d && { ...d, symbols: d.symbols.map((s) => (s.symbol !== symbol ? s : { ...s, rules: s.rules.map((r) => (r.kind !== kind ? r : { ...r, enabled, threshold })) })) });
    try {
      await api("/api/private/market-alerts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, kind, enabled, threshold }) });
    } catch (e) {
      setError((e as Error).message);
      load();
    } finally {
      setSaving(null);
    }
  }

  async function sendTest() {
    setTestMsg("Sending...");
    try {
      const r = await api<{ bell: boolean; telegram: boolean; push: boolean }>("/api/private/market-alerts", { method: "POST" });
      setTestMsg(`Sent to the bell${r.telegram ? ", Telegram" : ""}${r.push ? " and your devices" : ""}.`);
    } catch (e) {
      setTestMsg((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Market alerts"
        description="Get told when something worth a look happens: price near yesterday's high or low, volatility turning high, or a high-impact release minutes away. Information only - never a trade call."
        action={
          <Button variant="secondary" size="sm" onClick={sendTest}>
            Send a test alert
          </Button>
        }
      />
      {testMsg && <p className="mb-4 text-sm text-text-2">{testMsg}</p>}

      {state === "loading" && (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      )}
      {state === "error" && <ErrorState title="Market alerts are unavailable right now" description={error ?? "Please try again."} action={<Button variant="secondary" size="sm" onClick={load}>Retry</Button>} />}
      {state === "ready" && data && (
        <>
          <p className="mb-4 text-xs text-text-3">Alerts arrive in the bell. Connect Telegram or enable device notifications in your settings to get them there too.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {data.symbols.map((s) => (
              <Card key={s.symbol} padding="md" className="space-y-3">
                <p className="text-base font-semibold text-text">
                  {s.label} <span className="ml-1 font-mono text-xs text-text-3">{s.symbol}</span>
                </p>
                {s.rules.map((r) => {
                  const info = data.kinds.find((k) => k.kind === r.kind)!;
                  const key = `${s.symbol}:${r.kind}`;
                  return (
                    <div key={r.kind} className="flex items-start justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-[var(--gold)]"
                          checked={r.enabled}
                          disabled={saving === key}
                          onChange={(e) => save(s.symbol, r.kind, e.target.checked, r.threshold)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm text-text">{info.label}</span>
                          <span className="block text-xs leading-5 text-text-3">{info.help}</span>
                        </span>
                      </label>
                      {info.options && (
                        <Select
                          aria-label={`${info.label} (${info.unit})`}
                          className="shrink-0 !py-1 text-xs"
                          value={r.threshold}
                          disabled={saving === key}
                          onChange={(e) => save(s.symbol, r.kind, r.enabled, Number(e.target.value))}
                        >
                          {info.options.map((o) => (
                            <option key={o} value={o}>
                              {o} {info.unit.split(" ")[0] === "ATR" ? "ATR" : "min"}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  );
                })}
              </Card>
            ))}
          </div>
        </>
      )}
      <div className="mt-8">
        <Disclaimer />
      </div>
    </div>
  );
}
