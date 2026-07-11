// app/(auth)/layout.tsx
// Sprint 14C - Shared layout for auth pages (centered card).
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
