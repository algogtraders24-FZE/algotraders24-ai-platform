// app/marketplace/sell/page.tsx
// Sprint M9 - Seller submission entry point (M9 brief: "/marketplace/sell").
// Server-side auth gate (requireUser, same pattern as the admin dashboard's
// requireRole) before any seller UI renders - the real authorization
// decision is still enforced independently, server-side, by the API route
// itself (evaluateListingMutation) - this gate is UX, not the only defense.
import { requireUser } from "@/lib/auth/protectedRoute";
import SellClient from "./SellClient";

export const metadata = {
  title: "Submit a Trading System | AT24 Marketplace",
};

export default async function SellPage() {
  await requireUser("/login?redirect=/marketplace/sell");

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-bold text-text sm:text-3xl">Submit a Trading System</h1>
        <p className="mt-2 text-sm text-text-2">
          This creates a draft listing only. Nothing is published, and no performance claim you write here is ever treated
          as fact - every Trust State, Evidence, Validation, and Risk figure shown on the Marketplace comes from AT24&apos;s
          own independent verification pipeline, run after you submit for review.
        </p>
      </header>
      <SellClient />
    </div>
  );
}
