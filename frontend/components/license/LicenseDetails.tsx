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
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">License Details</h2>
        <LicenseStatus status={license.status} />
      </div>
      <div className="divide-y divide-[#1F2937]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between py-3 text-sm">
            <span className="text-gray-400">{label}</span>
            <span className="font-medium font-mono">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}