// app/dashboard/admin/rewards/page.tsx
// Admin: Algo Contracts. The /dashboard/admin layout already gates on the admin role; every API it calls checks again.
import AdminRewardsClient from "@/components/admin/AdminRewardsClient";

export const dynamic = "force-dynamic";

export default function AdminRewardsPage() {
  return <AdminRewardsClient />;
}
