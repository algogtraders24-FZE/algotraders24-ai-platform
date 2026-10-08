// components/marketplace/DemoTestedBadge.tsx
// Solid green "Demo-Tested" label for utility listings (e.g. the Local Trade Copier). It is NOT a Trust
// State - see isDemoTestedUtility() in lib/marketplace.ts - but it is deliberately loud so a buyer sees at
// a glance that the utility was really tested.
import { DEMO_TESTED_HINT } from "@/lib/marketplace";

export function DemoTestedBadge({ large = false }: { large?: boolean }) {
  return (
    <span
      title={DEMO_TESTED_HINT}
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-500 font-bold text-black shadow-[0_0_14px_rgba(16,185,129,0.55)] ${large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"}`}
    >
      <svg viewBox="0 0 16 16" width={large ? 14 : 12} height={large ? 14 : 12} aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Demo-Tested
    </span>
  );
}
