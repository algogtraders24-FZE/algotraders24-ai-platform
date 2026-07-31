import Link from "next/link";
import type { License } from "@/types/license";
import LicenseStatus from "./LicenseStatus";

function maskKey(key: string): string {
  const parts = key.split("-");
  return parts.map((p, i) => (i === 0 ? p : "••••")).join("-");
}

export default function LicenseCard({ license }: { license: License }) {
  return (
    <div className="rounded-2xl bg-ink-2 border border-border p-6 hover:border-gold transition">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-sm text-text-2">{maskKey(license.key)}</span>
        <LicenseStatus status={license.status} />
      </div>
      <div className="text-sm text-text-2 space-y-1">
        <div>Type: <span className="text-text capitalize">{license.type}</span></div>
        <div>Activations: <span className="text-text">{license.activations}/{license.maxActivations}</span></div>
        <div>Expires: <span className="text-text">{license.expiresAt ?? "Lifetime"}</span></div>
      </div>
      <Link
        href={`/dashboard/licenses/${license.id}`}
        className="inline-block mt-4 text-gold text-sm hover:underline"
      >
        View details →
      </Link>
    </div>
  );
}