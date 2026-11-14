// lib/content/developers.ts
// What the /developers page says. The limits and the paid-plan list are checked against the real MCP code by scripts/validate-developers-docs.ts,
// so this page cannot quietly drift from what the server does. Keep it factual: no guarantees, no resale terms, no internals.

export const MCP_ENDPOINT = "https://www.algotraders24.ai/api/mcp";
export const PUBLIC_RESULTS_ENDPOINT = "https://www.algotraders24.ai/api/public/live-results";

export interface McpToolDoc {
  name: string;
  blurb: string;
  /** Calls per user per UTC day (must equal MCP_DAILY_LIMITS). */
  dailyLimit: number;
  /** Needs an active paid plan. */
  paid: boolean;
}

export const MCP_TOOL_DOCS: readonly McpToolDoc[] = [
  { name: "market_snapshot", blurb: "Latest verified quote with its provider and freshness.", dailyLimit: 200, paid: false },
  { name: "market_intelligence", blurb: "Evidence-backed market context. Never a buy or sell signal.", dailyLimit: 20, paid: false },
  { name: "quant_backtest", blurb: "Run a strategy backtest and get the metrics.", dailyLimit: 5, paid: true },
  { name: "news_search", blurb: "Recent headlines for an instrument.", dailyLimit: 20, paid: false },
  { name: "economic_calendar", blurb: "This week's scheduled economic events.", dailyLimit: 100, paid: false },
  { name: "strategy_library_search", blurb: "Search legacy backtest results (evidence only, never validated).", dailyLimit: 100, paid: false },
  { name: "risk_calculator", blurb: "Position-size math from your own inputs.", dailyLimit: 1000, paid: false },
  { name: "edge_analysis", blurb: "Your own most recent saved Edge Analyzer analysis, condensed for an AI client. Yours only.", dailyLimit: 100, paid: true },
  { name: "live_results", blurb: "Public, terminal-reported results of accounts published on Live Results. Percent only, no ranking by gain.", dailyLimit: 200, paid: false },
];

export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http at24 ${MCP_ENDPOINT} --header "Authorization: Bearer YOUR_TOKEN"`;

export const GENERIC_MCP_CONFIG = `{
  "mcpServers": {
    "at24": {
      "type": "http",
      "url": "${MCP_ENDPOINT}",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}`;

export const CURL_EXAMPLE = `curl -s ${PUBLIC_RESULTS_ENDPOINT}`;

export const PYTHON_EXAMPLE = `import requests

r = requests.get("${PUBLIC_RESULTS_ENDPOINT}", timeout=20)
r.raise_for_status()
data = r.json()["data"]
print(data["source"])
for page in data["pages"]:
    print(page["slug"], page["trades"], page["gainPct"], page["maxDrawdownPct"])`;

export const JS_EXAMPLE = `const res = await fetch("${PUBLIC_RESULTS_ENDPOINT}");
if (!res.ok) throw new Error("HTTP " + res.status);
const { data } = await res.json();
console.log(data.source);
for (const p of data.pages) console.log(p.slug, p.trades, p.gainPct, p.maxDrawdownPct);`;

export const PUBLIC_RESULTS_FIELDS: readonly { name: string; meaning: string }[] = [
  { name: "slug, title, description", meaning: "Which public page it is." },
  { name: "platform, mode, broker", meaning: "Platform and account mode. The broker name appears only when the account owner chose to show it." },
  { name: "trades, winRatePct, profitFactor", meaning: "Closed-trade statistics." },
  { name: "gainPct, maxDrawdownPct, monthlyPct, yearlyPct", meaning: "Percent of the starting balance. Never money amounts." },
  { name: "liveForward, enoughData, edgeLevel", meaning: "How much of the record is live-forward, whether there is enough data to read, and the evidence level (a level, not a validation)." },
  { name: "lastSyncAt, stale", meaning: "When the terminal last reported, and whether the page is out of date." },
];

export const SECURITY_NOTES: readonly string[] = [
  "Everything is read-only. There is no tool that places, changes or closes a trade, and none is planned.",
  "A token belongs to you. Anyone holding it can use your daily limits, so keep it out of code, chats and screenshots. If it leaks, revoke it on your MCP page and create a new one.",
  "Tokens expire after 90 days, you can have up to 5 active at a time, and we store only a hash of each token, never the token itself.",
  "Treat what a tool returns as data, not as instructions. Headlines and other third-party text can contain anything. AT24 trims and cleans text that comes from a user's own files before it reaches an AI, but your agent should still not obey text found inside results.",
  "Daily limits are per user and reset at 00:00 UTC. Some tools need an active paid plan.",
  "We can switch the whole MCP service off instantly. Calls are logged so you can see your own recent usage.",
];

export const NOT_AVAILABLE: readonly string[] = [
  "No order placement or account access of any kind. We are an evidence layer, not a broker or an execution venue.",
  "No SDK yet. The examples on this page are all you need today; a public API and SDK are on the roadmap.",
  "No uptime or service-level guarantee. The service is read-only, informational and may change.",
];
