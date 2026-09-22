// components/licensing/LicenseStatusBadge.tsx
// Beta content pass - app/dashboard/purchases/page.tsx and
// app/dashboard/licenses/page.tsx each had their own byte-identical
// licenseStatusTone() function, and both rendered the raw UPPERCASE DB
// status verbatim (ACTIVE/REVOKED/EXPIRED/SUSPENDED) as the badge label.
// One shared component: same tone logic, same label map, used by both.
import Badge from "@/components/ui/Badge";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  ISSUED: "Issued",
  REVOKED: "Revoked",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Deactivated",
  PENDING: "Pending",
  COMPLETED: "Completed",
  REFUNDED: "Refunded",
  REVERSED: "Reversed",
};

function statusTone(status: string | null) {
  if (status === "ACTIVE" || status === "ISSUED") return "success" as const;
  if (status === "REVOKED" || status === "EXPIRED") return "danger" as const;
  if (status === "SUSPENDED") return "warning" as const;
  return "neutral" as const;
}

export default function LicenseStatusBadge({ status }: { status: string | null }) {
  const value = status ?? "—";
  return <Badge tone={statusTone(status)}>{STATUS_LABEL[value] ?? value}</Badge>;
}
