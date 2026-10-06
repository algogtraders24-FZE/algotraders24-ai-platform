// app/dashboard/help/ai-tools/page.tsx
// In-app guide for AT24 AI Tools (MCP). Tool names and daily limits come from the
// same constants the service enforces, so this page cannot drift from the product.
// The longer written manual lives at docs/AT24-AI-TOOLS-MCP-USER-MANUAL.md.
import PageHeader from "@/components/ui/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import GuideSection, { CodeBlock } from "@/components/help/GuideSection";
import { MCP_TOOL_NAMES, type McpToolName } from "@/services/mcp/mcp-tool-map";
import { MCP_DAILY_LIMITS } from "@/services/mcp/quota";

const ENDPOINT = "https://www.algotraders24.ai/api/mcp";

/** `Record<McpToolName, ...>`: adding a tool without documenting it here fails the type-check. */
const TOOL_DOCS: Record<McpToolName, { what: string; plan: string }> = {
  market_snapshot: { what: "Latest verified price for an instrument, with source and freshness.", plan: "All plans" },
  market_intelligence: { what: "Evidence-based market context. Not a signal. Says so when data is insufficient.", plan: "All plans" },
  economic_calendar: { what: "This week's scheduled economic events (time, currency, impact, forecast, previous).", plan: "All plans" },
  news_search: { what: "Recent headlines for an instrument (can legitimately return none).", plan: "All plans" },
  strategy_library_search: { what: "Search AT24's library of 100 legacy backtest results. Evidence only, never validated.", plan: "All plans" },
  risk_calculator: { what: "Position size from your balance, risk % and stop distance.", plan: "All plans" },
  quant_backtest: { what: "Run a backtest on an AT24 strategy and get metrics, trades and equity curve.", plan: "Paid plan (Quant Pro)" },
  edge_analysis: { what: "Your most recent saved Edge Analyzer analysis: verdict, key numbers, risk scenarios and where your results come from. Save one first in the Edge Analyzer.", plan: "Paid plan (Quant Pro)" },
};

const EXAMPLES = [
  "What is AT24's market context for EURUSD right now? Say if data is insufficient.",
  "Show this week's high-impact USD and EUR events.",
  "Search AT24's strategy library for XAUUSD 1h strategies with at least 30 trades.",
  "Backtest ref-ema-crossover on XAUUSD 1h from 2026-01-01 to 2026-06-01 and summarize drawdown and profit factor.",
  "Calculate position size: balance 5,000, risk 0.5%, entry 1.0850, stop 1.0820, 100000 per price unit per lot.",
  "Using my saved AT24 edge analysis, what are my biggest weaknesses, and what should I investigate next?",
];

const TROUBLE: [string, string][] = [
  ["Unauthorized / 401", "Token missing, wrong, expired or revoked. Create a new token and check you used the www address exactly as shown."],
  ["\"plan required\"", "quant_backtest and edge_analysis need an active paid plan."],
  ["\"usage limit reached\"", "The daily limit for that tool is used up. It resets at 00:00 UTC."],
  ["503 / \"temporarily unavailable\"", "The AI Tools service is switched off or in maintenance."],
  ["429 / \"too many requests\"", "Slow down and retry in about 30 seconds."],
  ["\"tool could not complete\"", "A data source was unavailable. AT24 does not fill gaps with guesses. Retry later."],
  ["Tools not listed", "Re-add the server, then restart your AI app."],
];

export default function AiToolsGuidePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="HOW-TO GUIDE"
        title="AT24 AI Tools (MCP)"
        description="Let your own AI app use AT24's market, backtest and risk tools in the same chat where you ask questions. Read-only: it never places trades, never asks for broker or MetaTrader passwords, and never gives buy/sell signals."
        action={<ButtonLink href="/dashboard/mcp" size="sm">Open AI Tools page</ButtonLink>}
      />

      <GuideSection title="Who is this for?">
        <p>Traders and developers who already use an AI app that supports MCP (Model Context Protocol). If you do not, you do not need this: every AT24 feature is available in the dashboard.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>An AT24 account (any plan can create a token; some tools need a paid plan).</li>
          <li>An MCP-compatible AI app that supports remote HTTP servers with a custom <code>Authorization</code> header, for example Claude Code.</li>
          <li>Optional: MetaTrader 5 with its own MCP enabled (see below).</li>
        </ul>
        <p className="text-xs text-text-3">Availability: if the service is not switched on yet, the AI Tools page shows a notice. You can create tokens in the meantime.</p>
      </GuideSection>

      <GuideSection title="Set up in about 2 minutes">
        <p><b className="text-text">1. Create a token.</b> Open <b>Account → AI Tools (MCP)</b>, enter a name (for example "Laptop Claude Code") and click <b>Create token</b>. Copy it immediately: it is shown only once. If you lose it, revoke it and create a new one. Tokens are read-only, expire after 90 days, and you can have up to 5 active tokens.</p>
        <p><b className="text-text">2. Connect your AI app.</b> Claude Code:</p>
        <CodeBlock>{`claude mcp add --transport http at24 ${ENDPOINT} --header "Authorization: Bearer YOUR_TOKEN"`}</CodeBlock>
        <p>Other MCP apps (check your app's documentation for where this goes):</p>
        <CodeBlock>{`{
  "mcpServers": {
    "at24": {
      "url": "${ENDPOINT}",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}`}</CodeBlock>
        <p className="text-xs text-text-3">Use the <code>www</code> address exactly as shown. The address without <code>www</code> redirects, and many apps drop the token when redirected, which causes an unauthorized error.</p>
        <p><b className="text-text">3. Try it.</b> Ask your AI: <i>"List the AT24 tools you can use."</i> You should see the tools below.</p>
      </GuideSection>

      <GuideSection title="What you get">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left">
            <thead className="text-xs text-text-3">
              <tr>
                <th className="py-1 pr-3">Tool</th>
                <th className="py-1 pr-3">What it does</th>
                <th className="py-1 pr-3">Plan</th>
                <th className="py-1">Daily limit</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOL_NAMES.map((name) => (
                <tr key={name} className="border-t border-border align-top">
                  <td className="py-2 pr-3 font-mono text-xs text-text">{name}</td>
                  <td className="py-2 pr-3">{TOOL_DOCS[name].what}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{TOOL_DOCS[name].plan}</td>
                  <td className="py-2">{MCP_DAILY_LIMITS[name]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Limits reset at 00:00 UTC. There is also a short-term rate limit. Not included: placing or managing orders, reading your MetaTrader account, signals or guarantees, price predictions. Anything unavailable is reported as unavailable; AT24 does not guess or fabricate data.</p>
      </GuideSection>

      <GuideSection title="Using AT24 together with MetaTrader 5 (optional)">
        <p>MetaTrader 5 has its own MCP server that runs on <b className="text-text">your own PC</b> (typically <code>http://127.0.0.1:22346/mcp</code>, with its own API key; see MetaQuotes' MCP configuration help). It gives your AI access to your account, positions and MT5's own data. You can add both servers to the same AI app: MT5 for your account and positions, AT24 for verified intelligence, backtests and risk math.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>AT24 never connects to your MetaTrader and never needs your MT5 API key. <b className="text-text">Do not share your MT5 API key with AT24 or anyone else.</b> It can control your terminal.</li>
          <li>Keep MetaTrader's AI trading permission disabled or set to require your confirmation.</li>
          <li>AT24 does not plug into MetaTrader 5's built-in AI Assistant; use an external AI app as described above.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Examples of what to ask">
        <ul className="list-disc space-y-1 pl-5">
          {EXAMPLES.map((e) => <li key={e}>{e}</li>)}
        </ul>
        <p className="text-xs text-text-3">For the risk calculator, "value per price unit per lot" depends on your broker's contract size (for example 100000 for EURUSD, 100 for XAUUSD on many brokers). Check your broker's specification.</p>
      </GuideSection>

      <GuideSection title="How to read the results">
        <ul className="list-disc space-y-1 pl-5">
          <li>Every answer includes its source and when it was retrieved.</li>
          <li>Strategy library results are labelled <b className="text-text">LEGACY-BACKTEST-EVIDENCE</b>: from an earlier engine, not validated and not recommendations. Re-test before relying on any idea.</li>
          <li>Market intelligence is context, not a buy/sell signal.</li>
          <li>Backtests describe the past under stated assumptions; they do not predict future results.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Troubleshooting">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left">
            <thead className="text-xs text-text-3"><tr><th className="py-1 pr-3">You see</th><th className="py-1">What it means</th></tr></thead>
            <tbody>
              {TROUBLE.map(([a, b]) => (
                <tr key={a} className="border-t border-border align-top"><td className="py-2 pr-3 text-text">{a}</td><td className="py-2">{b}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection title="Security and privacy">
        <ul className="list-disc space-y-1 pl-5">
          <li>Treat your token like a password: anyone holding it can use your daily limits. If it leaks, open <b>Account → AI Tools (MCP)</b> and click <b>Revoke</b>; it stops working immediately.</li>
          <li>AT24 stores only a hash of your token and never your broker or MetaTrader credentials.</li>
          <li>Each call is logged (tool name, time, success or error) for limits and security. The content of your questions and answers is not stored.</li>
        </ul>
        <p className="text-xs text-text-3">Informational analysis only. Not investment advice, not trading signals, not a recommendation to buy or sell. Trading involves risk, including loss of capital. MetaTrader is a trademark of MetaQuotes Ltd.; AT24 is not affiliated with MetaQuotes.</p>
      </GuideSection>
    </div>
  );
}
