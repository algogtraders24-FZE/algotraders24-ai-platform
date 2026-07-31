import type { License } from "@/types/license";
import LicenseStatus from "./LicenseStatus";

export default function LicenseDetails({ license }: { license: License }) {
  const rows: [string, string][] = [
    ["License Key", license.key],
    ["Type", license.type],
    ["Issued", license.issuedAt],
    ["Expires", license.expiresAt ?? "Lifetime"],
  ];

  return (
    <div className="rounded-2xl bg-ink-2 border border-border p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">License Details</h2>
        <LicenseStatus status={license.status} />
      </div>
      <div className="divide-y divide-border">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between py-3 text-sm">
            <span className="text-text-2">{label}</span>
            <span className="font-medium font-mono">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}