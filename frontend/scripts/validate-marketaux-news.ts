// scripts/validate-marketaux-news.ts
// Offline checks for the Marketaux news provider (fixtures shaped like the real responses seen on 2026-10-22; no network, no database).
// Usage: npx tsx --conditions=react-server scripts/validate-marketaux-news.ts
import { fetchMarketauxNews, MARKETAUX_SYMBOLS } from "../services/news/providers/marketaux.provider";
import { labelFromMarketauxScore, normalizeMarketauxArticle } from "../services/news/normalize.service";
import { mapMarketauxSymbol } from "../services/news/relevance.service";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed += 1;
}

const TOKEN = "test-token-not-real-0123456789";
process.env.MARKETAUX_API_TOKEN = TOKEN;

const sample = {
  data: [
    {
      uuid: "a1b2c3",
      title: "EUR/USD slips as the dollar firms",
      description: "The euro eased against the dollar on Thursday.",
      url: "https://example.com/eurusd-slips",
      source: "example.com",
      published_at: "2026-10-22T08:15:00.000000Z",
      entities: [
        { symbol: "EURUSD", type: "currency", sentiment_score: -0.2 },
        { symbol: "USDJPY", type: "currency", sentiment_score: -0.4 },
        { symbol: "AAPL", type: "equity", sentiment_score: 0.9 },
      ],
    },
    { uuid: "d4e5", title: "No entities here", description: "", url: null, source: "", published_at: null, entities: [] },
    { title: "missing uuid is dropped", entities: [] },
  ],
};

async function main() {
  // symbol mapping
  check("EURUSD maps to itself", mapMarketauxSymbol("EURUSD") === "EURUSD");
  check("CC:BTC maps to BTCUSD", mapMarketauxSymbol("CC:BTC") === "BTCUSD");
  check("an equity ticker is ignored", mapMarketauxSymbol("AAPL") === null);
  check("XAUUSD is not a Marketaux entity here", !MARKETAUX_SYMBOLS.includes("XAUUSD" as never));

  // sentiment label bands
  check("label bands", [-0.5, -0.2, 0, 0.2, 0.5].map(labelFromMarketauxScore).join() === "Bearish,Somewhat-Bearish,Neutral,Somewhat-Bullish,Bullish");

  // fetch: URL shape, no token in errors, field mapping
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(sample), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const raw = await fetchMarketauxNews("EURUSD", new Date("2026-10-20T10:30:45.000Z"));
  check("one request, symbol + after + sort in the URL", calls.length === 1 && calls[0].includes("symbols=EURUSD") && calls[0].includes("published_after=2026-10-20T10%3A30") && calls[0].includes("sort=published_at"));
  check("articles without a uuid are dropped", raw.length === 2, `got ${raw.length}`);
  check("empty strings become null", raw[1].source === null && raw[1].description === null && raw[1].url === null);

  // normalize
  const n = normalizeMarketauxArticle(raw[0]);
  check("only AT24-symbol entities drive sentiment (avg of -0.2 and -0.4)", n.sentimentScore === -0.3, String(n.sentimentScore));
  check("label from the averaged score", n.sentimentLabel === "Somewhat-Bearish", String(n.sentimentLabel));
  check("tagged EURUSD and USDJPY as native tickers", n.assetTags.includes("EURUSD") && n.assetTags.includes("USDJPY") && n.tagProvenance?.EURUSD?.method === "native_ticker");
  check("provider + stable id + url as dedupe key", n.provider === "marketaux" && n.providerArticleId === "a1b2c3" && n.dedupeKey === "https://example.com/eurusd-slips");
  const none = normalizeMarketauxArticle(raw[1]);
  check("no entities means no sentiment, never invented", none.sentimentScore === null && none.sentimentLabel === null);

  // errors never echo the token
  for (const [status, code, expected] of [[401, "invalid_api_token", "auth"], [402, "usage_limit_reached", "rate_limit"], [429, "rate_limit_reached", "rate_limit"], [500, "server_error", "http_error"]] as const) {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code } }), { status })) as typeof fetch;
    try {
      await fetchMarketauxNews("EURUSD", new Date());
      check(`HTTP ${status} throws`, false);
    } catch (e) {
      const err = e as { kind?: string; message?: string };
      check(`HTTP ${status} -> ${expected}, token not echoed`, err.kind === expected && !String(err.message).includes(TOKEN), `${err.kind} / ${err.message}`);
    }
  }
  globalThis.fetch = (async () => {
    throw new Error(`connect failed for https://api.marketaux.com/v1/news/all?api_token=${TOKEN}`);
  }) as typeof fetch;
  try {
    await fetchMarketauxNews("EURUSD", new Date());
    check("network failure throws", false);
  } catch (e) {
    const err = e as { kind?: string; message?: string };
    check("network failure message does not carry the token", err.kind === "http_error" && !String(err.message).includes(TOKEN), String(err.message));
  }
  globalThis.fetch = realFetch;

  // unconfigured
  delete process.env.MARKETAUX_API_TOKEN;
  try {
    await fetchMarketauxNews("EURUSD", new Date());
    check("missing token throws unconfigured", false);
  } catch (e) {
    check("missing token throws unconfigured", (e as { kind?: string }).kind === "unconfigured");
  }

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
