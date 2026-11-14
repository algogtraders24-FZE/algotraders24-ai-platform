// lib/content/prop-firms.ts
// Services for prop firms (B2B). Status is deliberately strict:
//   available - works today (as described, per trader unless the line says otherwise)
//   pilot     - the pieces exist; the firm-level version is built with the first firm
//   coming    - not built yet
// Edit THIS file to change what the page says; keep the status honest.

export type ServiceStatus = "available" | "pilot" | "coming";

export interface PropService {
  title: string;
  detail: string;
  status: ServiceStatus;
  /** One short line on what exists today. */
  today: string;
}

export interface ServiceGroup {
  id: string;
  heading: string;
  services: PropService[];
}

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  available: "Available now",
  pilot: "Pilot",
  coming: "Coming",
};

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  {
    id: "monitor",
    heading: "Monitor",
    services: [
      {
        title: "Rule monitoring",
        detail: "Daily loss, max loss, profit target and trading days checked against your limits, with an alert before a limit is reached.",
        status: "pilot",
        today: "A single trader sees this on their own account today (Prop Mode in Live Results, read-only, with the trader's consent). The firm-level dashboard across many traders is built with the first firm.",
      },
      {
        title: "Consistency and rule-style checks",
        detail: "Best day as a share of total profit, stop-loss use, overlapping positions (adding and hedging) and holding time, measured per trader.",
        status: "available",
        today: "In the Edge Analyzer (paid plans), per trader, from an MT5 report or synced history. Bulk use for a firm is part of the pilot.",
      },
    ],
  },
  {
    id: "screen",
    heading: "Screen",
    services: [
      {
        title: "Applicant trading history",
        detail: "Is the result distinguishable from luck? Where does it come from? How wide is the spread of outcomes? A deterministic reading of a trader's history.",
        status: "available",
        today: "Edge Analyzer: skill-vs-luck evidence level, breakdowns, Monte-Carlo risk view and a PDF.",
      },
      {
        title: "EA and backtest report check",
        detail: "A reality check of a submitted Expert Advisor backtest report, for firms that restrict or review automated strategies.",
        status: "pilot",
        today: "Built for our marketplace sellers' reports; a firm-facing version is part of the pilot.",
      },
    ],
  },
  {
    id: "analyze",
    heading: "Analyze",
    services: [
      {
        title: "Payout and scale-up risk report",
        detail: "How bad can the next stretch of trades get, using the trader's own results resampled thousands of times.",
        status: "available",
        today: "Edge Analyzer risk view, per trader (an illustration of spread, not a forecast).",
      },
      {
        title: "News-window flags",
        detail: "Trades opened or closed around high-impact releases.",
        status: "coming",
        today: "Needs a historical record of release times; not built yet.",
      },
      {
        title: "Cross-account similarity",
        detail: "Signs of coordinated or copied trading across accounts.",
        status: "coming",
        today: "Only ever with each trader's consent, and only after privacy and legal review.",
      },
    ],
  },
  {
    id: "equip",
    heading: "Equip and integrate",
    services: [
      {
        title: "Risk context feed",
        detail: "Economic calendar, a calibrated typical-move range per instrument and macro alignment, for risk desks and for your traders' own AI tools.",
        status: "available",
        today: "Read-only MCP server and public JSON endpoints, with tokens and daily quotas.",
      },
      {
        title: "Trader education",
        detail: "Risk-management lessons, guides and a daily market brief your traders can read.",
        status: "pilot",
        today: "Our lessons and daily reports are public; a version for your channels is part of the pilot.",
      },
      {
        title: "Approved-tools licensing",
        detail: "Licences for the Expert Advisors and indicators you approve for your traders. One key runs on one account.",
        status: "pilot",
        today: "Our licence system and marketplace exist; bulk licences for a firm are part of the pilot.",
      },
    ],
  },
];

export const NOT_WHAT_WE_DO: readonly string[] = [
  "We do not run challenges or funded accounts, and we are not a trading platform. We sit next to your stack, not in place of it.",
  "We do not do KYC, payments or CRM. Firms already buy those from specialists.",
  "We cannot detect latency arbitrage or tick-level abuse: that needs order-by-order telemetry, and we read closed deals and account snapshots.",
  "We do not sell signals and we do not trade. Everything is a measurement with its limits stated.",
  "We never monitor a trader without that trader's own consent.",
];

export const PILOT_STEPS: readonly { title: string; detail: string }[] = [
  { title: "Tell us your setup", detail: "Your platform (MT4, MT5, cTrader and so on), roughly how many traders, and which rules cause you the most work." },
  { title: "Pick what to try", detail: "One or two services from the list, on a small group of consenting traders or a batch of applicant reports." },
  { title: "Review together", detail: "We look at what it found and what it missed, and decide whether it is worth building further for you." },
];

export const PILOT_QUESTIONS = [
  "Firm name and website:",
  "Trading platform(s) you use:",
  "Approximate number of active traders:",
  "Which services above interest you most:",
  "Do you allow third-party read-only Expert Advisors on trader accounts (yes / no / not sure):",
];
