// app/dashboard/admin/wallet/page.tsx
// Admin: Wallet. Money in, money out, referral commissions and a daily summary. The /dashboard/admin layout already gates on the admin role.
import AdminWalletClient from "@/components/admin/AdminWalletClient";

export const dynamic = "force-dynamic";

export default function AdminWalletPage() {
  return <AdminWalletClient />;
}
