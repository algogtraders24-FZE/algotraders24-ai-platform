"use client";
// components/pwa/DeviceNotificationsPanel.tsx
// "Notifications on this device" (Live Sync page): install the app, allow notifications, pick which kinds, send a test, turn off.
// Renders nothing until the owner has switched push on. Notifications only inform; nothing here trades.
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import { detectPlatform, installHint, pushNeedsHomeScreen, urlBase64ToUint8Array, type DevicePlatform } from "@/lib/pwa/helpers";
import { hasInstallPrompt, isStandalone, promptInstall, registerServiceWorker, startInstallTracking, subscribeInstall } from "@/lib/pwa/install";

interface Server {
  configured: boolean;
  publicKey?: string;
  subscribed?: boolean;
  alertsOn?: boolean;
  watchOn?: boolean;
}

export default function DeviceNotificationsPanel() {
  const [server, setServer] = useState<Server | null>(null);
  const [platform, setPlatform] = useState<DevicePlatform>("desktop");
  const [standalone, setStandalone] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  const load = useCallback(async (ep: string | null) => {
    try {
      const r = await fetch(`/api/private/push${ep ? `?endpoint=${encodeURIComponent(ep)}` : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      setServer((await r.json()).data as Server);
    } catch {
      // stays hidden
    }
  }, []);

  useEffect(() => {
    startInstallTracking();
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
    setStandalone(isStandalone());
    const refresh = () => setHasPrompt(hasInstallPrompt());
    refresh();
    const unsub = subscribeInstall(refresh);
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
    void (async () => {
      let ep: string | null = null;
      if (ok) {
        const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.getRegistration());
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        ep = sub?.endpoint ?? null;
        setEndpoint(ep);
      }
      await load(ep);
    })();
    return unsub;
  }, [load]);

  async function call(init: RequestInit, key: string): Promise<{ ok: boolean; message?: string }> {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch("/api/private/push", { cache: "no-store", ...init, headers: { "content-type": "application/json" } });
      const j = await r.json().catch(() => null);
      return r.ok ? { ok: true } : { ok: false, message: j?.error?.message ?? "Something went wrong." };
    } catch {
      return { ok: false, message: "Network error. Try again." };
    } finally {
      setBusy(null);
    }
  }

  async function enable() {
    if (!server?.publicKey) return;
    setBusy("enable");
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setMsg({ tone: "danger", text: "Notifications are blocked for this site. Allow them in the browser's site settings, then try again." });
        return;
      }
      const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
      const ready = await navigator.serviceWorker.ready;
      const sub = (await (ready ?? reg).pushManager.getSubscription()) ?? (await (ready ?? reg).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(server.publicKey) as unknown as BufferSource }));
      const res = await call({ method: "POST", body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }) }, "enable");
      if (!res.ok) {
        setMsg({ tone: "danger", text: res.message ?? "Could not turn notifications on." });
        return;
      }
      setEndpoint(sub.endpoint);
      await load(sub.endpoint);
      setMsg({ tone: "success", text: "Notifications are on for this device. Press “Send a test notification” to check." });
    } catch {
      setMsg({ tone: "danger", text: "This browser could not turn notifications on. Try another browser, or install the app first." });
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await call({ method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }, "disable");
      await sub.unsubscribe().catch(() => false);
    }
    setEndpoint(null);
    await load(null);
    setMsg({ tone: "success", text: "Notifications are off for this device." });
  }

  async function prefs(p: { alertsOn?: boolean; watchOn?: boolean }) {
    if (!endpoint) return;
    const res = await call({ method: "POST", body: JSON.stringify({ action: "prefs", endpoint, ...p }) }, "prefs");
    if (!res.ok) setMsg({ tone: "danger", text: res.message ?? "Could not save." });
    await load(endpoint);
  }

  async function test() {
    const res = await call({ method: "POST", body: JSON.stringify({ action: "test" }) }, "test");
    setMsg(res.ok ? { tone: "success", text: "Sent. A notification should appear in a moment." } : { tone: "danger", text: res.message ?? "Could not send." });
  }

  if (!server || !server.configured) return null;
  const hint = installHint({ platform, standalone, hasPrompt });
  const needsHome = pushNeedsHomeScreen(platform, standalone);
  const subscribed = server.subscribed === true && endpoint !== null;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-text">Notifications on this device</p>
        {subscribed ? <Badge tone="success" className="normal-case">on</Badge> : <Badge tone="neutral" className="normal-case">off</Badge>}
        {standalone && <Badge tone="neutral" className="normal-case">installed app</Badge>}
      </div>
      <p className="text-sm text-text-2">
        Install AT24 like an app and get your Live Sync alerts and watched-page notices as notifications on this phone or computer. Free. It only informs: it never trades or closes anything.
      </p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {hint === "prompt" && <Button size="sm" variant="secondary" onClick={() => void promptInstall()}>Install the app</Button>}
      {hint === "ios-steps" && <p className="text-xs text-text-2">On iPhone/iPad: open this page in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>, and open AT24 from the new icon. Notifications work only from the installed app (iOS 16.4 or newer).</p>}
      {hint === "browser-menu" && <p className="text-xs text-text-2">To install: open the browser menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>}

      {!supported || needsHome ? (
        <p className="text-xs text-text-3">{needsHome ? "Install the app first (steps above), then open it from the home screen to turn notifications on." : "This browser does not support notifications. Try Chrome, Edge, Firefox or Safari 16.4+."}</p>
      ) : !subscribed ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={enable} loading={busy === "enable"}>Turn on notifications</Button>
          {permission === "denied" && <span className="text-xs text-amber-300">Blocked in this browser: allow notifications for this site first.</span>}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-text-2">
            <input type="checkbox" checked={server.alertsOn ?? true} onChange={(e) => void prefs({ alertsOn: e.target.checked })} disabled={busy === "prefs"} />
            Live Sync alerts (the ones you switched on for your accounts)
          </label>
          <label className="flex items-center gap-2 text-sm text-text-2">
            <input type="checkbox" checked={server.watchOn ?? true} onChange={(e) => void prefs({ watchOn: e.target.checked })} disabled={busy === "prefs"} />
            Watched pages: stopped reporting / back again
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={test} loading={busy === "test"}>Send a test notification</Button>
            <Button size="sm" variant="secondary" onClick={disable} loading={busy === "disable"}>Turn off on this device</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
