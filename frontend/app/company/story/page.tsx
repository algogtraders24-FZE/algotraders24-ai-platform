// app/company/story/page.tsx
// The full Company/About narrative the user supplied verbatim, split into
// its own standalone page (separate from the existing thin /company/about
// and /company/vision pages, which stay as-is). Section headings and body
// copy are reproduced as given - nothing here is a new claim invented for
// this page. Card links route to real, already-existing pages (/platform/*,
// /quant, /dashboard/*) rather than inventing new destinations.
import type { Metadata } from "next";
import Link from "next/link";
import {
  MessagesSquare,
  BarChart3,
  Sigma,
  Compass,
  BookOpen,
  Workflow,
  Bot,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Our Story",
  description: "Algotraders24 AI is building the intelligence infrastructure around the trader — from algorithmic trading discipline to a connected AI trading intelligence platform.",
  alternates: { canonical: "/company/story" },
};

const WORKFLOW_STAGES = ["Discover", "Research", "Analyse", "Quantify", "Test", "Decide", "Automate", "Learn"] as const;

const APPROACH_PRINCIPLES = [
  { title: "Evidence before assumption", detail: "Market analysis should begin with relevant information and evidence — not unsupported conclusions." },
  { title: "Context before reaction", detail: "A price movement means different things under different market conditions. Context matters." },
  { title: "Explainability before black boxes", detail: "AI should make complex information easier to understand, not hide the reasoning behind an unexplained output." },
  { title: "Discipline before emotion", detail: "Repeatable processes, defined rules, measurable conditions, and risk awareness create a stronger foundation for trading workflows." },
  { title: "Human judgment remains essential", detail: "AI can research, analyse, compare, calculate, monitor, and automate. The final decision remains with the trader." },
] as const;

const CAPABILITIES: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  { title: "AI Assistant", description: "Ask questions, explore markets, investigate ideas, and work with trading-related knowledge through an AI-native interface.", href: "/platform/assistant", icon: MessagesSquare },
  { title: "Market Intelligence", description: "Bring together market information, analysis, and relevant context to help traders understand what is happening.", href: "/platform/market-intelligence", icon: BarChart3 },
  { title: "Quantitative Analysis", description: "Explore systematic ideas, indicators, parameters, and strategy logic with a quantitative mindset.", href: "/quant", icon: Sigma },
  { title: "Trading Workspace", description: "Move from an idea toward structured analysis, strategy development, testing, and review.", href: "/platform/workspace", icon: Compass },
  { title: "Research & Knowledge", description: "Connect AI assistance with verified knowledge and research so information can become reusable intelligence.", href: "/platform/knowledge-base", icon: BookOpen },
  { title: "Automation", description: "Turn repeatable workflows into structured automated processes while maintaining visibility and control.", href: "/dashboard/automation", icon: Workflow },
  { title: "AI Agents", description: "Create specialized intelligence workflows for specific trading and research tasks.", href: "/dashboard/agents", icon: Bot },
];

const DISCIPLINE_POINTS = [
  "Rule-based decision logic",
  "Multi-factor analysis",
  "Defined risk parameters",
  "Drawdown and exposure controls",
  "Structured execution",
  "Transparent system behaviour",
  "Market-specific engineering",
] as const;

const VISION_STEPS = [
  "A question can lead to research.",
  "Research can lead to evidence.",
  "Evidence can lead to analysis.",
  "Analysis can become a testable strategy.",
  "A tested workflow can become an automation.",
  "And every step remains visible to the person making the decision.",
] as const;

const PRINCIPLES = [
  { number: "01", title: "Evidence", detail: "We value information that can be investigated, verified, and understood." },
  { number: "02", title: "Transparency", detail: "Users should be able to understand what a system is doing and what information supports an output." },
  { number: "03", title: "Discipline", detail: "Trading workflows should be structured, repeatable, and measurable wherever possible." },
  { number: "04", title: "Risk Awareness", detail: "No analytical system removes market risk. Good technology should make risk easier to see, understand, and manage." },
  { number: "05", title: "Continuous Improvement", detail: "Markets evolve. Technology evolves. Our platform must evolve with them." },
  { number: "06", title: "Human Control", detail: "Automation should extend human capability — not remove human responsibility." },
] as const;

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
      <h2 className="mt-4 font-display text-3xl font-medium md:text-4xl">{title}</h2>
    </div>
  );
}

export default function CompanyStoryPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />

      <PageHero
        eyebrow="Company"
        title="Intelligence for the way modern markets are traded."
        subtitle="We are building the AI Trading Intelligence Platform for traders who want more than information — they want understanding."
      />
      <section className="px-6 pb-4">
        <div className="mx-auto max-w-3xl space-y-4 text-center">
          <p className="text-sm leading-7 text-text-2">
            Algotraders24 AI brings market intelligence, quantitative analysis, research, trading workflows,
            automation, and AI assistance into one connected environment.
          </p>
          <p className="text-sm font-medium leading-7 text-text">
            Research deeper. Analyse with context. Test ideas. Automate with discipline.
          </p>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/platform" className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110">
            Explore the Platform
          </Link>
          <Link href="/company/vision" className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold">
            Our Vision
          </Link>
        </div>
      </section>

      {/* About */}
      <section className="px-6 py-16">
        <SectionHeading eyebrow="About Algotraders24 AI" title="From algorithmic systems to trading intelligence." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-sm leading-7 text-text-2">
          <p>
            Algotraders24 began with a simple idea: trading technology should be systematic, disciplined, and built
            around rules rather than emotion.
          </p>
          <p>
            That principle led us into algorithmic trading systems, quantitative methods, risk controls, and
            automated workflows across multiple markets.
          </p>
          <p className="text-text">Today, we are taking that foundation further.</p>
          <p>
            Algotraders24 AI is building a broader AI Trading Intelligence Platform — bringing together the tools
            traders need to research markets, understand information, explore quantitative ideas, evaluate
            strategies, monitor intelligence, and automate repeatable workflows.
          </p>
          <p className="font-medium text-text">
            Our ambition is not to create another collection of disconnected trading tools. We are building an
            intelligence layer around the trader.
          </p>
        </div>
      </section>

      {/* Our Purpose */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Our Purpose" title="Turn market information into usable intelligence." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-sm leading-7 text-text-2">
          <p>Financial markets produce an enormous amount of information every second.</p>
          <p>Prices move. News develops. Macro conditions change. Technical structures evolve. Quantitative relationships appear and disappear.</p>
          <p className="text-text">The challenge is no longer simply accessing information. The challenge is understanding what matters.</p>
          <p>Algotraders24 AI is designed to help traders move through that process:</p>
        </div>
        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {WORKFLOW_STAGES.map((stage, i) => (
            <span key={stage} className="flex items-center gap-2">
              <span className="rounded-control border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold">
                {stage}
              </span>
              {i < WORKFLOW_STAGES.length - 1 && <span className="text-text-3">→</span>}
            </span>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-7 text-text-2">
          The platform brings these stages closer together so traders can spend less time switching between
          disconnected tools and more time working with meaningful information.
        </p>
      </section>

      {/* Our Approach */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Our Approach" title="Intelligence, not signals." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-center text-sm leading-7 text-text-2">
          <p>We are not building Algotraders24 as a signal-selling platform.</p>
          <p>Our goal is to help traders understand markets and make their own informed decisions.</p>
          <p>That means our technology is designed around several principles:</p>
        </div>
        <div className="mx-auto mt-8 grid max-w-5xl gap-6 sm:grid-cols-2">
          {APPROACH_PRINCIPLES.map((principle) => (
            <div key={principle.title} className="rounded-card border border-border bg-ink-2 p-6">
              <h3 className="text-base font-semibold text-text">{principle.title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-2">{principle.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What We Are Building */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="What We Are Building" title="One intelligence layer across the trading workflow." />
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-7 text-text-2">
          Algotraders24 AI brings together a growing ecosystem of capabilities designed to work as parts of one
          platform.
        </p>
        <div className="mx-auto mt-8 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <Link
              key={capability.title}
              href={capability.href}
              className="group flex flex-col gap-3 rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                <capability.icon className="h-5 w-5 text-gold" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-base font-semibold text-text">{capability.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-text-2">{capability.description}</p>
              </div>
            </Link>
          ))}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-sm leading-7 text-text-2">
          These capabilities are part of the same long-term direction: build an environment where intelligence can
          move with the trader from research to execution-ready workflow.
        </p>
      </section>

      {/* Where We Come From */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Where We Come From" title="Built on algorithmic trading discipline." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-center text-sm leading-7 text-text-2">
          <p>
            Before expanding into AI trading intelligence, Algotraders24 built its foundation around rule-based
            algorithmic trading systems.
          </p>
          <p>That experience continues to influence how we design the platform today.</p>
          <p>Our algorithmic systems have been built around principles such as:</p>
        </div>
        <ul className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
          {DISCIPLINE_POINTS.map((point) => (
            <li key={point} className="flex items-center gap-3 rounded-control border border-border bg-ink-2 px-4 py-3 text-sm text-text-2">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
        <div className="mx-auto mt-8 max-w-3xl space-y-3 text-center text-sm leading-7 text-text-2">
          <p>We believe those principles matter even more as AI becomes part of the trading workflow.</p>
          <p className="font-medium text-text">
            More intelligence should not mean less discipline. It should mean better tools for applying it.
          </p>
        </div>
      </section>

      {/* Our Vision */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Our Vision" title="Build the intelligence infrastructure around the trader." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-center text-sm leading-7 text-text-2">
          <p>
            We believe the future of trading will not be defined simply by who has access to the most data.
          </p>
          <p>
            It will be defined by who can turn information into understanding — and understanding into a
            disciplined process.
          </p>
          <p>
            Our vision is to build Algotraders24 AI into a global intelligence platform where market research,
            quantitative analysis, AI, knowledge, strategy development, testing, and automation work together.
          </p>
          <p className="text-text">Imagine a trading environment where:</p>
        </div>
        <div className="mx-auto mt-6 max-w-2xl space-y-3">
          {VISION_STEPS.map((step) => (
            <p key={step} className="rounded-control border border-border bg-ink-2 px-5 py-3 text-center text-sm leading-6 text-text-2">
              {step}
            </p>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm font-medium leading-7 text-text">
          That is the direction we are building toward.
        </p>
      </section>

      {/* Our Principles */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Our Principles" title="The standards behind the platform." />
        <div className="mx-auto mt-8 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((principle) => (
            <div key={principle.number} className="rounded-card border border-border bg-ink-2 p-6">
              <span className="text-xs font-semibold tracking-[0.2em] text-gold">{principle.number}</span>
              <h3 className="mt-2 text-base font-semibold text-text">{principle.title}</h3>
              <p className="mt-2 text-sm leading-6 text-text-2">{principle.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What Makes Us Different */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="What Makes Algotraders24 Different" title="We are building for the complete trading workflow." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-center text-sm leading-7 text-text-2">
          <p>Many trading products focus on one part of the journey:</p>
          <p className="text-text-3">A chart. A signal. A bot. A research tool. An AI chatbot. A backtester.</p>
          <p>We see an opportunity to connect these pieces.</p>
          <p>
            Algotraders24 AI is being built around the complete journey from question to research, research to
            analysis, analysis to testing, and testing to repeatable workflow.
          </p>
          <p className="font-medium text-text">
            The objective is not simply to give traders more tools. It is to make the tools work together.
          </p>
        </div>
      </section>

      {/* Long-Term Direction */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Our Long-Term Direction" title="From trading tools to trading intelligence." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-center text-sm leading-7 text-text-2">
          <p>Today, Algotraders24 AI is building the foundation.</p>
          <p>
            Over time, that foundation can support increasingly sophisticated capabilities for individual traders,
            quantitative researchers, professional trading teams, and other market participants.
          </p>
          <p>The technology will continue to evolve.</p>
          <p>The interface will become more intelligent. The research layer will become deeper. The quantitative environment will become more capable. The automation layer will become more powerful.</p>
          <p className="text-text">But our core philosophy will remain the same:</p>
          <p className="font-medium text-text">
            Technology should help people understand markets better — not promise certainty in markets that are
            inherently uncertain.
          </p>
        </div>
      </section>

      {/* Built for the Next Generation */}
      <section className="px-6 py-16 border-t border-border">
        <SectionHeading eyebrow="Built for the Next Generation of Traders" title="The market is changing. The way we work with it should change too." />
        <div className="mx-auto mt-8 max-w-3xl space-y-5 text-center text-sm leading-7 text-text-2">
          <p>AI is changing how information is discovered, analysed, and acted upon.</p>
          <p>Quantitative methods are becoming more accessible.</p>
          <p>Automation is becoming increasingly sophisticated.</p>
          <p>
            The next generation of trading platforms will need to bring these capabilities together without
            sacrificing transparency, discipline, or human control.
          </p>
          <p className="text-text">That is what we are building at Algotraders24 AI.</p>
        </div>
        <div className="mx-auto mt-8 max-w-2xl rounded-card border border-border bg-ink-2 p-8 text-center">
          <p className="text-sm leading-7 text-text-2">Not another signal service.</p>
          <p className="text-sm leading-7 text-text-2">Not another collection of disconnected tools.</p>
          <p className="mt-3 text-base font-semibold text-gold">An intelligence platform for modern trading.</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-ink-2 py-16 text-text md:py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-4xl font-medium md:text-5xl">Explore the future of trading intelligence.</h2>
          <p className="mt-5 text-lg text-text-2">
            Discover a platform built to bring AI, market intelligence, quantitative analysis, research, strategy
            development, and automation into one connected environment.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link href="/platform" className="rounded-control bg-gold px-8 py-4 font-semibold text-ink transition hover:brightness-110">
              Explore Algotraders24 AI
            </Link>
            <Link href="/signup" className="rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold">
              Start Exploring
            </Link>
          </div>
        </div>
      </section>

      {/* Closing brand statement */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-2xl rounded-card border border-border bg-ink-2 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Algotraders24 AI</p>
          <p className="mt-2 text-base font-medium text-text">AI Trading Intelligence Platform</p>
          <div className="mt-5 space-y-1 text-sm leading-6 text-text-2">
            <p>Evidence-based intelligence.</p>
            <p>Quantitative thinking.</p>
            <p>Disciplined automation.</p>
            <p>Human-controlled decisions.</p>
          </div>
          <p className="mt-5 text-sm text-text-3">Built for traders. Built for research. Built for what comes next.</p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
