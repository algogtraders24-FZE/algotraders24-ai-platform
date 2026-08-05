// components/marketing/PlatformCTA.tsx
// Sprint D2.4.A1 - shared closing CTA for every /platform/* leaf page: a
// real deep link into the actual authenticated feature (never a generic
// "get started"), plus a secondary link to /pricing. Used by all 5 real
// platform pages so the conversion path is identical everywhere.
import Link from "next/link";

export default function PlatformCTA({ dashboardHref, dashboardLabel }: { dashboardHref: string; dashboardLabel: string }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-center">
      <div className="flex flex-wrap justify-center gap-4">
        <Link
          href={dashboardHref}
          className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110"
        >
          {dashboardLabel}
        </Link>
        <Link
          href="/pricing"
          className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold"
        >
          View Pricing
        </Link>
      </div>
    </div>
  );
}
