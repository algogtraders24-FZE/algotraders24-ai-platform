// components/marketing/PageHero.tsx
// Sprint D2.4.A1 - the same "eyebrow / h1 / subtitle" header pattern every
// homepage section already hand-rolls (PlatformOverview, ExplainableIntelligence,
// WhyChoose, etc.), extracted once because this IA sprint introduces enough new
// top-level pages that duplicating it ten more times would be the actual
// premature-duplication problem, not the abstraction. Existing homepage
// sections are left as-is - not a retrofit of already-shipped code.
export default function PageHero({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 pt-32 pb-4 text-center md:pt-40">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
      <h1 className="mt-4 font-display text-4xl font-medium md:text-5xl">{title}</h1>
      {subtitle && <p className="mt-5 text-lg text-text-2">{subtitle}</p>}
    </div>
  );
}
