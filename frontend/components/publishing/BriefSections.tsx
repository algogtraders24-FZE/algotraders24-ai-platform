// components/publishing/BriefSections.tsx
// Market Brief 2.0: renders the structured sections of a daily brief (hero chart, chips, bullets, scenario cards, plan, check, learn box).
// Server component, plain text only (the reader already sanitized every string and whitelisted the image host). Sections without a `kind`
// (every older article) fall back to the original heading + paragraph rendering, so nothing existing changes.
import type { BlogPostSection } from "@/types/publishing";

const CARD = "rounded-2xl border border-border bg-surface/60 p-4 md:p-5";

function Plain({ s }: { s: BlogPostSection }) {
  return (
    <section>
      {s.heading && <h2 className="text-xl font-semibold text-text">{s.heading}</h2>}
      <p className="mt-2 whitespace-pre-wrap leading-8 text-text-2">{s.body}</p>
    </section>
  );
}

export function hasBriefSections(sections: readonly BlogPostSection[]): boolean {
  return sections.some((s) => s.kind !== undefined);
}

export function BriefSections({ sections }: { sections: readonly BlogPostSection[] }) {
  return (
    <div className="space-y-8">
      {sections.map((s, i) => {
        switch (s.kind) {
          case "headline":
            // the headline is the page <h1> already; show only the date / source line
            return <p key={i} className="-mt-4 text-sm text-text-3">{s.body}</p>;
          case "chips":
            return (
              <ul key={i} className="flex flex-wrap gap-3" aria-label="Key numbers">
                {(s.chips ?? []).map((c, j) => (
                  <li key={j} className={`${CARD} min-w-[9rem]`}>
                    <span className="block text-lg font-semibold text-text">{c.value}</span>
                    <span className="block text-xs leading-5 text-text-3">{c.label}</span>
                  </li>
                ))}
              </ul>
            );
          case "hero":
            if (!s.image) return null;
            return (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a server-rendered chart PNG from our own storage (host allow-listed by the reader) */}
                <img src={s.image.url} alt={s.image.alt} width={1600} height={900} loading="eager" className="w-full rounded-2xl border border-border" />
                {s.image.caption && <figcaption className="mt-2 text-xs leading-5 text-text-3">{s.image.caption}</figcaption>}
              </figure>
            );
          case "bullets":
            return (
              <section key={i}>
                <h2 className="text-xl font-semibold text-gold">{s.heading}</h2>
                <ul className={`${CARD} mt-3 list-disc space-y-2 pl-9 leading-7 text-text-2`}>
                  {(s.bullets ?? []).map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              </section>
            );
          case "fit":
            return (
              <section key={i}>
                <h2 className="text-xl font-semibold text-gold">{s.heading}</h2>
                <p className="mt-3 rounded-r-2xl border-l-4 border-gold bg-surface/60 px-5 py-4 leading-8 text-text-2">{s.body}</p>
              </section>
            );
          case "scenarios":
            return (
              <section key={i}>
                <h2 className="text-xl font-semibold text-gold">{s.heading}</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {(s.cards ?? []).map((c, j) => (
                    <div key={j} className={CARD}>
                      <h3 className={`text-base font-semibold ${c.tone === "up" ? "text-emerald-400" : c.tone === "down" ? "text-sky-400" : "text-text"}`}>{c.title}</h3>
                      <p className="mt-1 text-sm leading-7 text-text-2">{c.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            );
          case "plan":
          case "check":
            return (
              <section key={i}>
                <h2 className="text-xl font-semibold text-gold">{s.heading}</h2>
                <p className={`${CARD} mt-3 leading-8 text-text-2`}>{s.body}</p>
              </section>
            );
          case "learn":
            return (
              <section key={i}>
                <h2 className="text-xl font-semibold text-gold">{s.heading}</h2>
                <p className="mt-3 rounded-2xl border border-dashed border-border bg-surface/40 p-4 leading-8 text-text-2 md:p-5">{s.body}</p>
              </section>
            );
          case "footer":
            return (
              <section key={i} className="border-t border-border pt-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-text-3">{s.heading}</h2>
                <p className="mt-2 text-xs leading-6 text-text-3">{s.body}</p>
              </section>
            );
          default:
            return <Plain key={i} s={s} />;
        }
      })}
    </div>
  );
}
