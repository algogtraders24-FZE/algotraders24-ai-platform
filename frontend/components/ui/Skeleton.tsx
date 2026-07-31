// components/ui/Skeleton.tsx
// Sprint D1.0 - The one loading-skeleton primitive. Replaces the repeated
// `animate-pulse rounded-xl border border-slate-800 bg-slate-900` (and its
// bg-[#0C1324]/rounded-2xl cousins) copy-pasted across nearly every
// dashboard page's loading branch.
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={["animate-pulse rounded-card bg-ink-3", className].filter(Boolean).join(" ")} />;
}
