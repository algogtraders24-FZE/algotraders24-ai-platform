"use client";
// components/telegram/TelegramPanel.tsx
// "Get your alerts on Telegram": connect through a one-time link (never by typing a chat id), switch the two kinds on/off,
// send a test, disconnect. Renders nothing until the owner has switched Telegram on. Alerts only inform; nothing trades.
import { useCallback, useEffect, useRef, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Status {
  configured: boolean;
  botUsername?: string;
  linked?: boolean;
  username?: string | null;
  alertsOn?: boolean;
  watchOn?: boolean;
}

const POLL_MS = 3000;
const POLL_MAX_MS = 3 * 60_000;

export default function TelegramPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (): Promise<Status | null> => {
    try {
      const r = await fetch("/api/private/telegram", { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      setSt(j.data as Status);
      return j.data as Status;
    } catch {
      return null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWaiting(false);
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function call(init: RequestInit, key: string): Promise<{ ok: boolean; data?: Record<string, unknown>; message?: string }> {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch("/api/private/telegram", { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
      const j = await r.json().catch(() => null);
      if (!r.ok) return { ok: false, message: j?.error?.message ?? "Something went wrong." };
      return { ok: true, data: j?.data };
    } catch {
      return { ok: false, message: "Network error. Try again." };
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    const res = await call({ method: "POST", body: JSON.stringify({ action: "link" }) }, "link");
    if (!res.ok) return setMsg({ tone: "danger", text: res.message ?? "Could not create the link." });
    const url = String(res.data?.url ?? "");
    setLink(url);
    window.open(url, "_blank", "noopener,noreferrer");
    setMsg({ tone: "info", text: "Telegram opened in a new tab. Press START in the chat with the AT24 bot. This page will update by itself." });
    setWaiting(true);
    const startedAt = Date.now();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const s = await load();
      if (s?.linked) {
        stopPolling();
        setLink(null);
        setMsg({ tone: "success", text: "Connected. Press “Send a test message” to check it." });
      } else if (Date.now() - startedAt > POLL_MAX_MS) {
        stopPolling();
        setMsg({ tone: "info", text: "Still not connected. The link works for 15 minutes: press Connect Telegram again if you closed the tab." });
      }
    }, POLL_MS);
  }

  async function disconnect() {
    const res = await call({ method: "DELETE" }, "unlink");
    if (!res.ok) return setMsg({ tone: "danger", text: res.message ?? "Could not disconnect." });
    setMsg({ tone: "success", text: "Disconnected. You will not get alerts on Telegram any more." });
    await load();
  }

  async function prefs(p: { alertsOn?: boolean; watchOn?: boolean }) {
    const res = await call({ method: "POST", body: JSON.stringify({ action: "prefs", ...p }) }, "prefs");
    if (!res.ok) setMsg({ tone: "danger", text: res.message ?? "Could not save." });
    await load();
  }

  async function test() {
    const res = await call({ method: "POST", body: JSON.stringify({ action: "test" }) }, "test");
    setMsg(res.ok ? { tone: "success", text: "Sent. Check Telegram." } : { tone: "danger", text: res.message ?? "Could not send." });
    await load();
  }

  if (!st || !st.configured) return null;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-text">Alerts on Telegram</p>
        {st.linked ? <Badge tone="success" className="normal-case">connected{st.username ? ` as @${st.username}` : ""}</Badge> : <Badge tone="neutral" className="normal-case">not connected</Badge>}
      </div>
      <p className="text-sm text-text-2">
        Get your Live Sync alerts (margin level, daily loss, drawdown, EA offline, no stop loss) and notices about the Live Results pages you watch in your own private Telegram chat. Free. It only informs: it never trades or closes anything, and AT24 never sees your Telegram password or phone number.
      </p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!st.linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={connect} loading={busy === "link"} disabled={waiting}>{waiting ? "Waiting for you in Telegram…" : "Connect Telegram"}</Button>
          {link && <a className="text-xs text-gold hover:underline" href={link} target="_blank" rel="noreferrer">Telegram did not open? Open the link</a>}
          <span className="text-xs text-text-3">Opens the AT24 bot (@{st.botUsername}); you press START once.</span>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-text-2">
            <input type="checkbox" checked={st.alertsOn ?? true} onChange={(e) => void prefs({ alertsOn: e.target.checked })} disabled={busy === "prefs"} />
            Live Sync alerts (the ones you switched on for your accounts)
          </label>
          <label className="flex items-center gap-2 text-sm text-text-2">
            <input type="checkbox" checked={st.watchOn ?? true} onChange={(e) => void prefs({ watchOn: e.target.checked })} disabled={busy === "prefs"} />
            Watched pages: stopped reporting / back again
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={test} loading={busy === "test"}>Send a test message</Button>
            <Button size="sm" variant="secondary" onClick={disconnect} loading={busy === "unlink"}>Disconnect</Button>
          </div>
          <p className="text-xs text-text-3">You can also send /status or /stop to the bot in Telegram.</p>
        </div>
      )}
    </Card>
  );
}
