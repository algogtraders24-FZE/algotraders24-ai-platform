"use client";
// components/pwa/PwaProvider.tsx
// Mounted once in the dashboard layout: registers the service worker (push only, caches nothing), starts tracking the install
// prompt, and shows a slim, dismissible "Install the app" bar to PHONE users who have not installed it. It never blocks the page.
import { useEffect, useState } from "react";
import Image from "next/image";
import { detectPlatform, installBannerHidden, installHint } from "@/lib/pwa/helpers";
import { hasInstallPrompt, isStandalone, promptInstall, readDismissedAt, registerServiceWorker, startInstallTracking, subscribeInstall, writeDismissedAt } from "@/lib/pwa/install";

export default function PwaProvider() {
  const [show, setShow] = useState(false);
  const [hint, setHint] = useState<ReturnType<typeof installHint>>("none");
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    startInstallTracking();
    void registerServiceWorker();
    const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    setIos(platform === "ios");
    const refresh = () => {
      const h = installHint({ platform, standalone: isStandalone(), hasPrompt: hasInstallPrompt() });
      setHint(h);
      setShow(platform !== "desktop" && (h === "prompt" || h === "ios-steps") && !installBannerHidden(readDismissedAt(), Date.now()));
    };
    refresh();
    return subscribeInstall(refresh);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    writeDismissedAt(Date.now());
    setShow(false);
  };

  return (
    <div role="region" aria-label="Install the AT24 app" className="fixed inset-x-3 bottom-40 z-40 rounded-xl border border-border bg-ink-2 p-3 shadow-lg md:hidden">
      <div className="flex items-center gap-3">
        <Image src="/pwa/icon-192.png" alt="" width={40} height={40} unoptimized priority className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text">Install AT24 on your phone</p>
          <p className="text-xs text-text-3">Opens like an app and can send your alerts as notifications.</p>
        </div>
        {hint === "prompt" ? (
          <button className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-ink" onClick={() => void promptInstall().then((r) => r !== "unavailable" && dismiss())}>Install</button>
        ) : (
          <button className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-ink" onClick={() => setHelp((v) => !v)} aria-expanded={help}>How</button>
        )}
        <button className="px-1 text-lg leading-none text-text-3" onClick={dismiss} aria-label="Not now">×</button>
      </div>
      {help && ios && <p className="mt-2 text-xs text-text-2">In Safari tap the <b>Share</b> button, then <b>Add to Home Screen</b>. Open AT24 from the new icon to get notifications.</p>}
    </div>
  );
}
