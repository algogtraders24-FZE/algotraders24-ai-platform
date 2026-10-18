// lib/content/release-notes.ts
// Public release notes: written by hand from what actually shipped (merged PRs), in plain language.
// Rule: only features that are live for every visitor/user. Programs still behind a switch or awaiting legal review
// (rewards, referral commissions, wallet) are deliberately NOT listed. Newest first; add an entry per release.

export interface ReleaseEntry {
  date: string; // ISO yyyy-mm-dd
  title: string;
  items: string[];
}

export const RELEASE_NOTES: readonly ReleaseEntry[] = [
  {
    date: "2026-10-18",
    title: "Licences, account moves and a simpler home page",
    items: [
      "A licence key now only runs the product it was bought for.",
      "Buyers can move a licence to a different trading account (2 changes in 30 days); a key still works on one account at a time.",
      "Pricing and FAQ now say plainly what an AI credit is: 1 credit = 1 AI chat message.",
      "A plainer home page: Start Free first, features in two groups, the marketplace right below pricing.",
      "Better search results for marketplace listings (structured data is now only sent when a listing has a real price and release).",
    ],
  },
  {
    date: "2026-10-16",
    title: "AT24 Copilot writes answers as you watch",
    items: [
      "The support Copilot streams its answer on screen as it is written.",
      "Conversations are remembered: open your history and pick up where you left off.",
      "Questions the Copilot already answered no longer open a support ticket.",
    ],
  },
  {
    date: "2026-10-15",
    title: "Live market pages and a wider volatility band around big releases",
    items: [
      "New public Markets hub: /markets and one page for each of 7 instruments, with the typical move range, key levels, drivers, upcoming events, past analyses and related listings.",
      "The stated volatility range now widens in windows that contain US CPI, payrolls or a Fed decision. Our own test showed the plain band was too narrow there. The research behind it is on the Research page.",
      "The Calibration Scoreboard splits ordinary windows from release windows, so you can see where the range is reliable.",
      "Live Sync accepts any broker symbol style (XAUUSD+, #AAPL, BTC/USD and so on).",
      "Support answers are faster and the Copilot understands short follow-up questions.",
    ],
  },
  {
    date: "2026-10-14",
    title: "Daily reports, Calibration Scoreboard and honest SMC wording",
    items: [
      "Daily market reports (Gold, a forex pair, a crypto pair, a weekly review, the economic calendar and a fundamental report) now publish automatically to the blog.",
      "New public Calibration Scoreboard: every volatility range we state is checked afterwards against what price really did.",
      "New Methodology page explains how each number is produced.",
      "Brief 2.0 adds the day's range and key levels to the market brief; Market Alerts can notify you near yesterday's high or low, when volatility is high, or before an important event.",
      "Smart-money-concept structure is now labelled as context, not a predictor, after our backtests found no reliable directional edge.",
      "My Trading Rules: write your own risk rules once and the AI Assistant answers with them in mind.",
      "Fixed document uploads that failed in production.",
    ],
  },
  {
    date: "2026-10-13",
    title: "Macro alignment, richer evidence and a clearer dashboard",
    items: [
      "Macro Alignment now covers Gold, EUR/USD, USD/JPY, Bitcoin and crude oil, each with its own set of drivers.",
      "Market data now comes from MT5 first, with a fallback provider; macro cards use real DXY, Nasdaq, S&P, oil, silver, AUD/JPY and copper readings.",
      "Market Intelligence now uses real macro, cross-asset and news evidence, and a stale reading is treated as unavailable instead of being used.",
      "New Profile page and account menu.",
      "A new dashboard Market snapshot: macro mini cards, the next risk event and your latest automation result.",
      "Resend the verification email from the sign-in page without needing a session.",
    ],
  },
  {
    date: "2026-10-12",
    title: "Automation results reach you; MT4 and MT5 install guides",
    items: [
      "Scheduled automations now complete reliably and deliver their result exactly once, in a readable form you can edit.",
      "Step-by-step MT5 and MT4 install guide with licence setup and troubleshooting.",
      "The MT4 licence download button now shows the right file type (.ex4).",
    ],
  },
  {
    date: "2026-10-10",
    title: "Live Sync portfolio and self-serve product updates",
    items: [
      "Live Sync: all your synced accounts in one table (a portfolio view).",
      "Sellers can upload a new product version and attach a backtest report from My Products.",
      "Installable app and push notifications (add AT24 to your home screen).",
    ],
  },
  {
    date: "2026-10-09",
    title: "Live Results and an MT4 Live Sync EA",
    items: [
      "Live Results: public, Myfxbook-style pages for accounts that opt in, with an export and an optional broker name.",
      "Live Sync now has an Expert Advisor for MetaTrader 4 as well as MetaTrader 5.",
      "Sellers see their earnings and the 10% platform commission, and can request USDT payouts.",
    ],
  },
  {
    date: "2026-10-08",
    title: "Live Sync alerts and following accounts",
    items: [
      "Live Sync raises alerts on your account and shows them in the in-app bell.",
      "Watch a Live Results account and see it update in your dashboard by itself.",
      "Marketplace listings can show the Live Results card of the account behind them.",
    ],
  },
];
