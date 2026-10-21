// app/dashboard/algo-contracts/page.tsx
// Algo Contracts is no longer offered on the site. The pages are removed from the user-facing site; the backend (services, tables,
// admin screens) is kept as it was. Old links and emails land on the dashboard.
import { redirect } from "next/navigation";

export default function AlgoContractsPage() {
  redirect("/dashboard");
}
