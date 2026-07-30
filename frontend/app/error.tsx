// app/error.tsx
// Sprint R1.0.1 - Next.js App Router convention: a Client Component error
// boundary automatically wrapped around everything below the root layout.
// Previously absent, so any uncaught render/render-time error crashed to
// Next's generic default error screen instead of a branded, recoverable
// page. Never renders the raw error message/stack to the user (production
// safety - real internals shouldn't leak to visitors); it's still logged
// to the console so it's visible in server/browser logs.
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
      <p className="text-sm font-semibold uppercase tracking-widest text-red-400">Error</p>
      <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Something went wrong</h1>
      <p className="mt-3 max-w-md text-sm text-slate-400">
        An unexpected error occurred. You can try again, or head back to the homepage.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-slate-600">Reference: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
        >
          Go to homepage
        </Link>
      </div>
    </div>
  );
}
