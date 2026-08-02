// app/(auth)/layout.tsx
// Sprint 14C - Shared layout for auth pages (centered card).
// Brand Identity v1.0 - the official logo now crowns every auth screen
// (login, signup, forgot/reset password) from this one place.
import type { ReactNode } from "react";
import Link from "next/link";
import BrandLogo from "@/components/brand/BrandLogo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-4 py-10">
      <Link href="/" aria-label="Algotraders24 AI home" className="mb-6">
        <BrandLogo variant="stacked" className="h-32" />
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
