// app/dashboard/algo-contracts/guide/page.tsx
// Algo Contracts is no longer offered on the site (see ../page.tsx). Old links land on the dashboard.
import { redirect } from "next/navigation";

export default function AlgoContractsGuidePage() {
  redirect("/dashboard");
}
