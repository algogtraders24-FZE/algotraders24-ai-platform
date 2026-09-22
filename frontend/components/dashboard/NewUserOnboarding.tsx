// components/dashboard/NewUserOnboarding.tsx
// Sprint R1.1 - Shown on the dashboard home instead of the (all-zero) stats
// grid when a user has no conversations and no documents yet.
// Sprint D1.0 - Retrofitted onto Card/Button + tokens.
// Sprint UI-01 - header now uses the shared PageHeader (same eyebrow/title/
// description shape as the rest of the app), module icons are real lucide
// components instead of emoji, matching QuickActions/StatCard. Same three
// modules, same hrefs.
// Beta content pass (reapplied post-UI-01) - the description previously
// claimed "Algotraders24 is built around three modules that work together",
// inaccurate now that the real nav has far more than three. Reworded to not
// imply totality.
import { Bot, LineChart, FileText } from "lucide-react";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import Card from "@/components/ui/Card";
import ButtonLink from "@/components/ui/ButtonLink";
import PageHeader from "@/components/ui/PageHeader";

const MODULES = [
  {
    icon: Bot,
    title: "AI Assistant",
    description:
      "Ask trading and market questions in plain language. It answers using the knowledge you upload and can run a live market analysis on request.",
    href: "/dashboard/assistant",
    cta: "Start a conversation",
  },
  {
    icon: LineChart,
    title: "Market Intelligence",
    description:
      "Runs a deterministic evidence → risk → confidence pipeline against live market data and explains its reasoning - not a black-box prediction.",
    href: "/dashboard/market-intelligence",
    cta: "Run your first analysis",
  },
  {
    icon: FileText,
    title: "Knowledge Intelligence",
    description:
      "Upload your own documents (PDF, DOCX, TXT, Markdown). They're indexed and retrieved by the AI Assistant to ground its answers in your material.",
    href: "/dashboard/knowledge",
    cta: "Upload a document",
  },
] as const;

export default function NewUserOnboarding({
  name,
  email,
  emailVerified,
}: {
  name: string;
  email: string;
  emailVerified: boolean;
}) {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Welcome"
        title={`Welcome to Algotraders24, ${name}`}
        description={
          <>
            Your account is set up. Here are three good places to start - pick any one below, there&apos;s no
            required order. The full platform (Quant, Automation, Marketplace, and more) is in the sidebar whenever
            you&apos;re ready for it.
            <br />
            <span className="text-xs text-text-3">
              {email}
              {!emailVerified && (
                <>
                  {" "}
                  · email not verified · <ResendVerificationButton />
                </>
              )}
            </span>
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        {MODULES.map((m) => (
          <Card key={m.href} className="flex flex-col">
            <m.icon size={22} className="text-gold" aria-hidden="true" />
            <h3 className="mt-3 text-title text-text">{m.title}</h3>
            <p className="mt-2 flex-1 text-sm text-text-2">{m.description}</p>
            <ButtonLink href={m.href} className="mt-4">
              {m.cta}
            </ButtonLink>
          </Card>
        ))}
      </div>
    </div>
  );
}
