// app/global-error.tsx
// Sprint R1.0.1 - Next.js App Router convention: catches errors thrown by
// the ROOT layout itself (app/layout.tsx), which app/error.tsx cannot
// catch since it renders inside that same layout. Must render its own
// <html>/<body> since it replaces the entire root layout when triggered.
// Previously absent - a root-layout-level crash fell through to the
// framework's unbranded default screen with no recovery action at all.
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#020617",
            color: "#f1f5f9",
            padding: "24px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#f87171" }}>
            Error
          </p>
          <h1 style={{ marginTop: 12, fontSize: 28, fontWeight: 700 }}>Something went wrong</h1>
          <p style={{ marginTop: 12, maxWidth: 420, fontSize: 14, color: "#94a3b8" }}>
            An unexpected error occurred while loading the application. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 28,
              borderRadius: 8,
              backgroundColor: "#4f46e5",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              padding: "10px 20px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
