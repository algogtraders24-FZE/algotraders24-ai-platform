// components/dashboard/NewUserOnboarding.tsx
// Sprint R1.1 - Shown on the dashboard home instead of the (all-zero) stats
// grid when a user has no conversations and no documents yet - the current
// best available signal for "hasn't used the product yet" without adding a
// new "onboarded" column (out of scope: no schema/architecture changes this
// sprint). Replaces the generic "Welcome back" + empty stats with an actual
// explanation of the product and a concrete next action, per the sprint's
// "never use fake statistics" rule - no numbers are shown here at all.
import Link from "next/link";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";

const MODULES = [
  {
    icon: "🤖",
    title: "AI Assistant",
    description:
      "Ask trading and market questions in plain language. It answers using the knowledge you upload and can run a live market analysis on request.",
    href: "/dashboard/assistant",
    cta: "Start a conversation",
  },
  {
    icon: "📊",
    title: "Market Intelligence",
    description:
      "Runs a deterministic evidence → risk → confidence pipeline against live market data and explains its reasoning - not a black-box prediction.",
    href: "/dashboard/market-intelligence",
    cta: "Run your first analysis",
  },
  {
    icon: "📄",
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
      <div>
        <h1 className="text-2xl font-bold">Welcome to Algotraders24, {name} &#128075;</h1>
        <p className="mt-1 max-w-2xl text-gray-400">
          Your account is set up. Algotraders24 is built around three modules that work together - pick any one
          below to get started, there&apos;s no required order.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {email}
          {!emailVerified && (
            <>
              {" "}
              · email not verified · <ResendVerificationButton />
            </>
          )}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {MODULES.map((m) => (
          <div
            key={m.href}
            className="flex flex-col rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6"
          >
            <span className="text-2xl">{m.icon}</span>
            <h3 className="mt-3 font-bold">{m.title}</h3>
            <p className="mt-2 flex-1 text-sm text-gray-400">{m.description}</p>
            <Link
              href={m.href}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              {m.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
