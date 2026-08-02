// sections/DashboardShowcase.tsx
// Sprint D2.1 (Phase 11) - the real product, not a mockup. Every image in
// public/showcase/ is a genuine screenshot captured from an authenticated
// session against the live app (the Market Intelligence shot is a real
// EUR/USD run through the deterministic pipeline - note it honestly reports
// HIGH risk / LOW confidence because most evidence types were unavailable,
// exactly as the platform is designed to). Screenshots are unedited except
// for cropping out the account holder's name/email; no data is fabricated or
// retouched. Server Component: static images + text, no interactivity.
import Image from "next/image";
import { Link2, ShieldAlert, Gauge, Repeat2 } from "lucide-react";

const CALLOUTS = [
  { icon: Link2, text: "Every claim carries an attributed source and timestamp." },
  { icon: ShieldAlert, text: "Risk is assessed across eight categories and disclosed." },
  { icon: Gauge, text: "Confidence is scored 0–100 from real evidence, never asserted." },
  { icon: Repeat2, text: "Deterministic — the same evidence returns the same analysis." },
];

function Dot({ tone }: { tone: string }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />;
}

function BrowserFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-panel border border-border bg-ink-2 shadow-raised">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span aria-hidden="true" className="flex gap-1.5">
          <Dot tone="bg-steel/40" />
          <Dot tone="bg-steel/40" />
          <Dot tone="bg-gold/50" />
        </span>
        <span className="text-xs font-medium text-text-2">{title}</span>
        <span className="ml-auto rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
          Live screenshot
        </span>
      </div>
      {children}
    </div>
  );
}

export default function DashboardShowcase() {
  return (
    <section className="relative overflow-hidden bg-ink-2 py-16 text-text md:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-[26rem] w-[42rem] -translate-x-1/2 rounded-full bg-gold/5 blur-3xl"
      />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Dashboard</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">See the real platform, not a mockup</h2>
          <p className="mt-5 text-lg text-text-2">
            Actual screenshots from the live product — including a real analysis run. Nothing staged, nothing retouched.
          </p>
        </div>

        <div className="mt-16 grid items-center gap-8 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <BrowserFrame title="Market Intelligence — Explainable Analysis">
              <Image
                src="/showcase/market-intelligence.png"
                alt="A real EUR/USD analysis: overall risk High, confidence Low (20/100), with supporting evidence and an eight-category risk breakdown."
                width={1440}
                height={1010}
                className="h-auto w-full"
                sizes="(max-width: 1024px) 100vw, 60vw"
              />
            </BrowserFrame>
          </div>

          <div className="lg:col-span-2">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-gold">A real run — EUR/USD</p>
            <p className="mt-3 text-sm leading-7 text-text-2">
              This isn&apos;t a rendered demo. It&apos;s the deterministic pipeline analysing live price evidence — and
              honestly reporting <span className="text-text">High risk</span> and{" "}
              <span className="text-text">Low confidence</span>{" "}
              because most evidence types weren&apos;t available. It
              never pretends to know more than it does.
            </p>
            <ul className="mt-6 space-y-4">
              {CALLOUTS.map((c) => (
                <li key={c.text} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                    <c.icon className="h-4 w-4 text-gold" aria-hidden="true" />
                  </span>
                  <span className="text-sm leading-6 text-text-2">{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 grid gap-8">
          <BrowserFrame title="AI Assistant">
            <Image
              src="/showcase/assistant.png"
              alt="The AI Assistant workspace — grounded, evidence-based answers with quick prompts for markets and concepts."
              width={1440}
              height={840}
              className="h-auto w-full"
              sizes="(max-width: 1024px) 100vw, 90vw"
            />
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}
