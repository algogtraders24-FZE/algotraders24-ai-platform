// app/developers/page.tsx
// Developers: what is actually available to build on today - the read-only MCP server and one public JSON endpoint - with working examples
// instead of an SDK. Facts come from lib/content/developers.ts, which scripts/validate-developers-docs.ts checks against the real code.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import {
  CLAUDE_CODE_COMMAND,
  CURL_EXAMPLE,
  GENERIC_MCP_CONFIG,
  JS_EXAMPLE,
  MCP_ENDPOINT,
  MCP_TOOL_DOCS,
  NOT_AVAILABLE,
  PUBLIC_RESULTS_ENDPOINT,
  PUBLIC_RESULTS_FIELDS,
  PYTHON_EXAMPLE,
  SECURITY_NOTES,
} from "@/lib/content/developers";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Build on Algotraders24 AI: a read-only MCP server for AI tools (market context, calendar, risk maths, backtests) and a public JSON endpoint for Live Results. Examples included.",
  alternates: { canonical: "/developers" },
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-control border border-border bg-ink p-4 text-xs leading-6 text-text-2">
      <code>{children}</code>
    </pre>
  );
}

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Developers"
        title="Build on AT24's evidence"
        subtitle="Read-only access to market context, the economic calendar, risk maths and public Live Results, for your own tools and AI agents. No trading, no execution."
      />

      <section id="mcp" className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">MCP server</h2>
          <Card padding="lg">
            <p className="text-sm leading-6 text-text-2">
              The AT24 MCP server lets an MCP-compatible AI client (Claude Code, Cursor and others that support remote HTTP servers) call the tools below on your
              behalf. It is read-only, uses Streamable HTTP and authenticates with a personal token.
            </p>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-text-2">
              <li>
                Sign in and open{" "}
                <Link href="/dashboard/mcp" className="text-gold underline-offset-4 hover:underline">
                  your MCP page
                </Link>
                , then create a token (shown once; expires in 90 days).
              </li>
              <li>
                Use the endpoint <code className="rounded bg-ink px-1.5 py-0.5 text-xs">{MCP_ENDPOINT}</code>. Use the <b>www</b> address: the bare domain redirects, and clients drop the
                Authorization header on a redirect.
              </li>
              <li>Add it to your client and replace YOUR_TOKEN with your token:</li>
            </ol>
            <p className="mt-4 text-xs font-semibold text-text-2">Claude Code</p>
            <Code>{CLAUDE_CODE_COMMAND}</Code>
            <p className="mt-4 text-xs font-semibold text-text-2">Generic JSON config</p>
            <Code>{GENERIC_MCP_CONFIG}</Code>
          </Card>

          <Card padding="lg">
            <h3 className="text-base font-semibold">Tools</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs text-text-3">
                  <tr>
                    <th className="py-2 pr-3">Tool</th>
                    <th className="py-2 pr-3">What it returns</th>
                    <th className="py-2 pr-3">Per day</th>
                    <th className="py-2">Plan</th>
                  </tr>
                </thead>
                <tbody className="text-text-2">
                  {MCP_TOOL_DOCS.map((t) => (
                    <tr key={t.name} className="border-t border-border align-top">
                      <td className="py-2.5 pr-3 font-mono text-xs text-text">{t.name}</td>
                      <td className="py-2.5 pr-3">{t.blurb}</td>
                      <td className="py-2.5 pr-3">{t.dailyLimit}</td>
                      <td className="py-2.5">{t.paid ? <Badge tone="gold" className="normal-case">Paid</Badge> : "Any"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-3">
              Results are informational analysis, not investment advice or trading signals. Data that is unavailable is reported as unavailable, never guessed.
            </p>
          </Card>
        </div>
      </section>

      <section id="public-json" className="px-6 pb-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Public JSON: Live Results</h2>
          <Card padding="lg">
            <p className="text-sm leading-6 text-text-2">
              <code className="rounded bg-ink px-1.5 py-0.5 text-xs">GET {PUBLIC_RESULTS_ENDPOINT}</code> returns a compact summary of every public Live Results page. No sign-in, CORS is open,
              responses are cached for about five minutes and requests are rate-limited per client (HTTP 429 with a Retry-After header).
            </p>
            <p className="mt-3 text-sm leading-6 text-text-2">
              The response is <code className="rounded bg-ink px-1.5 py-0.5 text-xs">{`{ status, data: { generatedAt, source, disclaimer, pages } }`}</code>. Figures are terminal-reported, not verified
              by a broker, and shown as percentages only. There is no ranking by gain on purpose. Fields can be added over time.
            </p>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-text-2">
              {PUBLIC_RESULTS_FIELDS.map((f) => (
                <li key={f.name}>
                  <code className="rounded bg-ink px-1.5 py-0.5 text-xs text-text">{f.name}</code> {f.meaning}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs font-semibold text-text-2">curl</p>
            <Code>{CURL_EXAMPLE}</Code>
            <p className="mt-4 text-xs font-semibold text-text-2">Python</p>
            <Code>{PYTHON_EXAMPLE}</Code>
            <p className="mt-4 text-xs font-semibold text-text-2">JavaScript</p>
            <Code>{JS_EXAMPLE}</Code>
          </Card>
        </div>
      </section>

      <section id="security" className="px-6 pb-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Security and good practice</h2>
          <Card padding="lg">
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
              {SECURITY_NOTES.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Card>

          <h2 className="pt-4 text-xs font-semibold uppercase tracking-[0.2em] text-gold">What is not available</h2>
          <Card padding="lg">
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
              {NOT_AVAILABLE.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-text-2">
              More guides are in the{" "}
              <Link href="/resources/documentation" className="text-gold underline-offset-4 hover:underline">
                documentation
              </Link>{" "}
              and{" "}
              <Link href="/resources/tutorials" className="text-gold underline-offset-4 hover:underline">
                tutorials
              </Link>
              . Where this is heading is on the{" "}
              <Link href="/resources/roadmap" className="text-gold underline-offset-4 hover:underline">
                roadmap
              </Link>
              . Questions or something you need? Write to{" "}
              <a href="mailto:support@algotraders24.ai" className="text-gold underline-offset-4 hover:underline">
                support@algotraders24.ai
              </a>
              .
            </p>
          </Card>
        </div>
      </section>

      <Footer />
    </main>
  );
}
