// app/dashboard/algo-test-live/page.tsx
// Live Execution (Paper) - Phase 1. Same server-side access-boundary
// pattern as app/dashboard/quant-chat/page.tsx: hasQuantProAccess gates
// which UI renders (a UX convenience), while the real authorization
// boundary is the identical check re-run inside
// /api/private/algo-test/live-execution/tick/route.ts itself.
import { requireUser } from "@/lib/auth/protectedRoute";
import { hasQuantProAccess } from "@/lib/access/quant-pro";
import LiveExecutionClient from "./LiveExecutionClient";
import QuantProUpgradeGate from "@/components/quant-chat/QuantProUpgradeGate";

export default async function LiveExecutionPage() {
  const sessionUser = await requireUser();
  const entitled = await hasQuantProAccess(sessionUser.profile.id);
  if (!entitled) return <QuantProUpgradeGate />;
  return <LiveExecutionClient />;
}
