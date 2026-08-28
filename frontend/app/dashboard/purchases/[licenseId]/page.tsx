// app/dashboard/purchases/[licenseId]/page.tsx
// Sprint M13 (closing the marketplace delivery loop) - everything a buyer
// needs to actually run their purchased EA: the exact 4 values EA inputs
// require (License ID, API Key via RevealApiKeyButton, Buyer ID, Release
// ID - see GoldFire_v5.mq5 / AT24_GOLD_PDHPDL_RangeBreaker_v2.10.mq5's own
// AT24 LICENSE input group), a real download link, and real activation
// history from marketplace_evidence... no, from the real Activation table.
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/protectedRoute";
import { getMyLicenseDetail } from "@/services/licensing/myPurchases";
import Badge from "@/components/ui/Badge";
import RevealApiKeyButton from "@/components/license/RevealApiKeyButton";

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-text-3">{label}</p>
      <code className="mt-1 block overflow-x-auto rounded-lg border border-border bg-ink px-3 py-2 text-xs text-text">{value}</code>
    </div>
  );
}

function activationStatusTone(status: string) {
  return status === "ACTIVE" ? ("success" as const) : ("neutral" as const);
}

export default async function LicenseDetailPage({ params }: { params: Promise<{ licenseId: string }> }) {
  const { licenseId } = await params;
  const sessionUser = await requireUser();
  const license = await getMyLicenseDetail(licenseId, sessionUser.profile.id);
  if (!license) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">{license.listingTitle}</h1>
        <div className="mt-2 flex items-center gap-2">
          <Badge tone={license.licenseStatus === "ACTIVE" || license.licenseStatus === "ISSUED" ? "success" : "danger"}>{license.licenseStatus}</Badge>
          <span className="text-xs text-text-3">Issued {new Date(license.issuedAt).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-ink-3 p-6">
        <h2 className="text-sm font-semibold text-text">1. Download</h2>
        <p className="mt-1 text-xs text-text-2">The exact compiled build your license authorizes.</p>
        <a
          href={`/api/private/licenses/${license.licenseId}/download`}
          className="mt-3 inline-block rounded-control bg-gold px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          Download EA (.ex5)
        </a>
      </div>

      <div className="rounded-2xl border border-border bg-ink-3 p-6">
        <h2 className="text-sm font-semibold text-text">2. EA Setup Values</h2>
        <p className="mt-1 text-xs text-text-2">
          Paste these into the EA&apos;s inputs after attaching it to your chart. You also need one one-time MT5 setting:
          Tools → Options → Expert Advisors → check &quot;Allow WebRequest for listed URL&quot; → add{" "}
          <code className="rounded bg-ink px-1.5 py-0.5 text-[11px]">https://www.algotraders24.ai</code>.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <CopyField label="InpLicenseId" value={license.licenseId} />
          <CopyField label="InpBuyerId" value={license.buyerId} />
          <CopyField label="InpReleaseId" value={license.releaseId} />
          <CopyField label="Platform" value={license.platform} />
        </div>
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-text-3">InpApiKey</p>
          <div className="mt-1">
            <RevealApiKeyButton licenseId={license.licenseId} />
          </div>
        </div>
        <p className="mt-4 text-xs text-text-3">
          Activation limit: {license.activationPolicy.maxActivations} device{license.activationPolicy.maxActivations === 1 ? "" : "s"} at a time.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-ink-3 p-6">
        <h2 className="text-sm font-semibold text-text">3. Activation History</h2>
        {license.activations.length === 0 ? (
          <p className="mt-2 text-sm text-text-2">No activations yet - attach the EA with the values above to activate.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {license.activations.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm text-text">{a.deviceLabel || "Unlabeled device"}</p>
                  <p className="mt-0.5 text-[11px] text-text-3">
                    Activated {new Date(a.activatedAt).toLocaleString()}
                    {a.lastValidatedAt ? ` · last validated ${new Date(a.lastValidatedAt).toLocaleString()}` : ""}
                  </p>
                </div>
                <Badge tone={activationStatusTone(a.status)}>{a.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
