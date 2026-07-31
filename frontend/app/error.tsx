// app/error.tsx
// Sprint R1.0.1 - Next.js App Router convention: a Client Component error
// boundary automatically wrapped around everything below the root layout.
// Never renders the raw error message/stack to the user (production safety);
// it's still logged to the console so it's visible in server/browser logs.
// Sprint D1.0 - Retrofitted onto tokens + Button/ButtonLink (slate-950/
// indigo/red -> ink/gold/danger).
"use client";

import { useEffect } from "react";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";

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
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center text-text">
      <p className="text-sm font-semibold uppercase tracking-widest text-danger">Error</p>
      <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Something went wrong</h1>
      <p className="mt-3 max-w-md text-sm text-text-2">
        An unexpected error occurred. You can try again, or head back to the homepage.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-text-3">Reference: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/" size="lg" variant="secondary">
          Go to homepage
        </ButtonLink>
      </div>
    </div>
  );
}
