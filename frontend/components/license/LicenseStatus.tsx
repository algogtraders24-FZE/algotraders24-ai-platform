import type { LicenseStatus as Status } from "@/types/license";
import { LICENSE_STATUS_META } from "@/config/license.config";

export default function LicenseStatus({ status }: { status: Status }) {
  const meta = LICENSE_STATUS_META[status];
  return (
    <span
      className="text-xs font-semibold px-3 py-1 rounded-full"
      style={{ backgroundColor: `${meta.color}20`, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}