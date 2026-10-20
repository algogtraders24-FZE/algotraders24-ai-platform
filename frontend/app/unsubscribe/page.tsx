"use client";
// app/unsubscribe/page.tsx
// Public page behind the "Unsubscribe from product updates" link in announcement emails. The click on the email link only opens this
// page; the opt-out itself happens when the person presses the button (so link pre-fetching by mail scanners cannot unsubscribe anyone).
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function UnsubscribeInner() {
  const sp = useSearchParams();
  const u = sp.get("u") ?? "";
  const t = sp.get("t") ?? "";
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function confirm() {
    setState("busy");
    try {
      const res = await fetch(`/api/unsubscribe?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) setState("done");
      else {
        setMessage(body?.error ?? "Something went wrong.");
        setState("error");
      }
    } catch {
      setMessage("Network error - please try again.");
      setState("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-4">
      <div className="w-full rounded-2xl border border-border bg-ink-2 p-6 text-center">
        <p className="text-xs font-semibold tracking-[0.25em] text-gold">ALGOTRADERS24 AI</p>
        {state === "done" ? (
          <>
            <h1 className="mt-4 text-xl font-bold text-text">You are unsubscribed</h1>
            <p className="mt-2 text-sm text-text-2">We will not send you product update emails again. Account emails (security, purchases, support) still reach you.</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-xl font-bold text-text">Unsubscribe from product updates?</h1>
            <p className="mt-2 text-sm text-text-2">You will stop receiving emails about new products and features. Account emails (security, purchases, support) are not affected.</p>
            {!u || !t ? (
              <p className="mt-4 text-sm text-danger">This link is incomplete. Reply to the email with the word &ldquo;unsubscribe&rdquo; and we will do it for you.</p>
            ) : (
              <button
                type="button"
                onClick={confirm}
                disabled={state === "busy"}
                className="mt-5 inline-flex items-center justify-center rounded-control bg-gold px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
              >
                {state === "busy" ? "Saving..." : "Yes, unsubscribe me"}
              </button>
            )}
            {state === "error" && <p className="mt-3 text-sm text-danger">{message}</p>}
          </>
        )}
      </div>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
