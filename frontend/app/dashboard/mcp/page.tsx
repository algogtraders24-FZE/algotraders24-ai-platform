"use client";
// app/dashboard/mcp/page.tsx
// AT24 MCP v1 - API tokens + connection guide for the read-only MCP endpoint.
// Talks only to /api/private/mcp/tokens (session-authenticated). The raw token
// is shown ONCE in this session's memory and never persisted client-side.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

// Must be the canonical www host: the apex 308-redirects to www, and clients
// drop the Authorization header when following a cross-host redirect.
const ENDPOINT = "https://www.algotraders24.ai/api/mcp";

const TOOLS: { name: string; blurb: string }[] = [
  { name: "market_snapshot", blurb: "Latest verified quote with provider and freshness." },
  { name: "market_intelligence", blurb: "Evidence-backed market context. Never a buy/sell signal." },
  { name: "quant_backtest", blurb: "Run a strategy backtest and get the metrics." },
  { name: "news_search", blurb: "Recent headlines for an instrument." },
  { name: "economic_calendar", blurb: "This week's scheduled economic events." },
  { name: "strategy_library_search", blurb: "Search legacy backtest results (evidence only, never validated)." },
  { name: "risk_calculator", blurb: "Position-size math from your own inputs." },
];

interface UsageSummary {
  serviceEnabled: boolean;
  resetsAt: string;
  tools: { name: string; used: number; limit: number; remaining: number }[];
  recent: { tool: string; ok: boolean; errorCode: string | null; durationMs: number; at: string }[];
}

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : "-";
}

function status(t: TokenRow): { label: string; tone: "success" | "danger" | "neutral" } {
  if (t.revokedAt) return { label: "Revoked", tone: "danger" };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return { label: "Expired", tone: "neutral" };
  return { label: "Active", tone: "success" };
}

export default function McpPage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/private/mcp/usage", { cache: "no-store" });
      const body = await res.json();
      if (res.ok) setUsage(body.data as UsageSummary);
    } catch {
      // Usage is informational; the rest of the page works without it.
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/mcp/tokens", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not load tokens");
      setTokens(body.data.tokens as TokenRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tokens");
    }
    await loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/private/mcp/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not create token");
      setFresh(body.data.token as string);
      setName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/private/mcp/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Could not revoke token");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke token");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const tokenForSnippet = fresh ?? "YOUR_TOKEN";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ACCOUNT"
        title="AI Tools (MCP)"
        description="Connect AT24's read-only market intelligence and quant tools to any MCP-compatible AI client. AT24 never places orders and never asks for broker credentials."
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {usage && !usage.serviceEnabled && (
        <Alert tone="warning">
          The AT24 AI Tools service is not switched on yet. You can create tokens now; connections will work once the service is enabled.
        </Alert>
      )}

      {fresh && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-text">Your new token</p>
          <p className="text-sm text-text-2">Copy it now. For your security it is shown only once and cannot be recovered.</p>
          <code className="block break-all rounded-control border border-border bg-ink-2 p-3 text-xs text-text">{fresh}</code>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => copy(fresh)}>{copied ? "Copied" : "Copy token"}</Button>
            <Button size="sm" variant="secondary" onClick={() => setFresh(null)}>I have saved it</Button>
          </div>
        </Card>
      )}

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Create a token</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name (e.g. Claude Code laptop)" aria-label="Token name" />
          <Button onClick={create} loading={busy}>Create token</Button>
        </div>
        <p className="text-xs text-text-3">Read-only. Expires in 90 days. Up to 5 active tokens.</p>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Your tokens</p>
        {tokens.length === 0 ? (
          <p className="text-sm text-text-2">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((t) => {
              const s = status(t);
              return (
                <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-text">
                      {t.name} <span className="font-mono text-xs text-text-3">{t.prefix}…</span>{" "}
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </p>
                    <p className="text-xs text-text-3">
                      Created {fmt(t.createdAt)} · Last used {fmt(t.lastUsedAt)} · Expires {fmt(t.expiresAt)}
                    </p>
                  </div>
                  {s.label === "Active" && (
                    <Button size="sm" variant="secondary" onClick={() => revoke(t.id)} disabled={busy}>Revoke</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-text">Today&apos;s usage</p>
          <Button size="sm" variant="secondary" onClick={() => void loadUsage()}>Refresh</Button>
        </div>
        {!usage ? (
          <p className="text-sm text-text-2">Loading…</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {usage.tools.map((t) => (
                <li key={t.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-mono text-text">{t.name}</span>
                  <span className="text-text-2">{t.used} / {t.limit} used</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-3">Daily limits reset at {fmt(usage.resetsAt)} (00:00 UTC).</p>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Recent calls</p>
        {!usage || usage.recent.length === 0 ? (
          <p className="text-sm text-text-2">No calls yet. Once your AI app uses AT24, calls appear here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {usage.recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-mono text-text">{r.tool}</span>{" "}
                  <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "OK" : r.errorCode ?? "Error"}</Badge>
                </span>
                <span className="text-xs text-text-3">{fmt(r.at)} · {r.durationMs} ms</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-text-3">Only the tool name, time, result and duration are recorded, never your questions or the answers.</p>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Connect a client</p>
        <p className="text-sm text-text-2">
          Use any MCP client that supports remote HTTP servers with a custom <code>Authorization</code> header.
        </p>
        <p className="text-xs font-semibold text-text-2">Claude Code</p>
        <code className="block break-all rounded-control border border-border bg-ink-2 p-3 text-xs text-text">
          {`claude mcp add --transport http at24 ${ENDPOINT} --header "Authorization: Bearer ${tokenForSnippet}"`}
        </code>
        <p className="text-xs font-semibold text-text-2">Generic JSON config</p>
        <pre className="overflow-x-auto rounded-control border border-border bg-ink-2 p-3 text-xs text-text">
{`{
  "mcpServers": {
    "at24": {
      "url": "${ENDPOINT}",
      "headers": { "Authorization": "Bearer ${tokenForSnippet}" }
    }
  }
}`}
        </pre>
        <p className="text-xs text-text-3">Keep your token private. Anyone holding it can use your quota. Revoke it here if it leaks.</p>
      </Card>

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">Available tools</p>
        <ul className="space-y-2">
          {TOOLS.map((t) => (
            <li key={t.name} className="text-sm text-text-2">
              <span className="font-mono text-text">{t.name}</span> - {t.blurb}
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-3">
          Daily limits apply per tool. Results are informational analysis, not investment advice or trading signals. Data that is unavailable is reported as unavailable, never guessed.
        </p>
      </Card>
    </div>
  );
}
