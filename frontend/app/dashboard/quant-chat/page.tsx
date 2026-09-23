// app/dashboard/quant-chat/page.tsx
// Quant Pro production launch - the real server-side access boundary for
// Quant Chat. Unauthenticated access is already redirected to /login by
// the parent app/dashboard/layout.tsx (requireUser()); this page's own
// requireUser() call is the same, cheap, defense-in-depth pattern other
// protected dashboard pages use. The entitlement check
// (lib/access/quant-pro.ts hasQuantProAccess) is what's actually new: it
// reuses the EXISTING Plan/Subscription system (no new entitlement model,
// per the launch's locked decision) to decide which of the two UI states
// renders. This is a UX convenience only - the real authorization
// boundary is the identical check re-run server-side inside the
// /api/private/algo-test/strategy-builder and /ai-runs routes themselves,
// since client-side/page-level gating alone is never sufficient.
//
// QP-0 through QP-5's own implementation is unchanged and untouched -
// see QuantChatClient.tsx (moved here verbatim from what used to be this
// file, before the entitlement gate needed a server component in front
// of it).
import { requireUser } from "@/lib/auth/protectedRoute";
import { hasQuantProAccess } from "@/lib/access/quant-pro";
import QuantChatClient from "./QuantChatClient";
import QuantProUpgradeGate from "@/components/quant-chat/QuantProUpgradeGate";

export default async function QuantChatPage() {
  const sessionUser = await requireUser();
  const entitled = await hasQuantProAccess(sessionUser.profile.id);
  if (!entitled) return <QuantProUpgradeGate />;
  return <QuantChatClient />;
}
