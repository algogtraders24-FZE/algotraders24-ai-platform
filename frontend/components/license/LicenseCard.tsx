import Link from "next/link";
import type { License } from "@/types/license";
import LicenseStatus from "./LicenseStatus";

function maskKey(key: string): string {
  const parts = key.split("-");
  return parts.map((p, i) => (i === 0 ? p : "••••")).join("-");
}

export default function LicenseCard({ license }: { license: License }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6 hover:border-blue-500 transition">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-sm text-gray-300">{maskKey(license.key)}</span>
        <LicenseStatus status={license.status} />
      </div>
      <div className="text-sm text-gray-400 space-y-1">
        <div>Type: <span className="text-white capitalize">{license.type}</span></div>
        <div>Activations: <span className="text-white">{license.activations}/{license.maxActivations}</span></div>
        <div>Expires: <span className="text-white">{license.expiresAt ?? "Lifetime"}</span></div>
      </div>
      <Link
        href={`/dashboard/licenses/${license.id}`}
        className="inline-block mt-4 text-blue-400 text-sm hover:underline"
      >
        View details →
      </Link>
    </div>
  );
}