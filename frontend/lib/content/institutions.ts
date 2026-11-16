// lib/content/institutions.ts
// Services for institutions: brokers, wealth and fintech platforms (B2B). Same strict status rule as the prop-firm page:
//   pilot  - the pieces exist today; the partner-level version (branding, partner keys, delivery) is built with the first partner
//   coming - not built yet
// Nothing here is "available now" for a partner today, so nothing is labelled that way. Edit THIS file to change what the page says.
import type { ServiceStatus } from "./prop-firms";

export interface InstitutionService {
  title: string;
  detail: string;
  status: ServiceStatus;
  today: string;
}

export interface InstitutionGroup {
  id: string;
  heading: string;
  services: InstitutionService[];
}

export const INSTITUTION_GROUPS: readonly InstitutionGroup[] = [
  {
    id: "clients",
    heading: "For your clients",
    services: [
      {
        title: "Market Context widget and API",
        detail:
          "For each instrument: a typical-move range that is checked afterwards against what price really did, key levels, macro alignment and the next risk event. Branded for your portal or app.",
        status: "pilot",
        today:
          "The same context is public today on our Markets pages, and the range accuracy is public on the Calibration Scoreboard. The embeddable, partner-keyed version is built with the first partner, and which market data may be shown to your clients is agreed with you first.",
      },
      {
        title: "White-label market reports",
        detail: "Daily, weekly, fundamental and economic-calendar reports for your blog, newsletter or Telegram, in your name and language.",
        status: "pilot",
        today: "We publish these reports automatically every day on our own blog. A branded feed for a partner is built with the first partner.",
      },
      {
        title: "Evidence-grounded AI assistant",
        detail: "Let your clients' AI assistant answer from AT24's evidence tools, with sources and the limits stated, instead of guessing.",
        status: "pilot",
        today: "A read-only MCP server with nine tools, personal tokens and daily limits exists today (see the Developers page). Partner-level keys and limits are part of the pilot.",
      },
    ],
  },
  {
    id: "risk",
    heading: "For your risk and compliance team",
    services: [
      {
        title: "Strategy-provider vetting",
        detail:
          "A reality check of the track record behind a signal, copy or strategy-provider programme: is the result distinguishable from luck, where does it come from, how wide is the spread of outcomes.",
        status: "pilot",
        today: "Our Edge Analyzer reads a trader's MT5 history, and our report check reads submitted backtest reports. A batch workflow for a programme is part of the pilot.",
      },
    ],
  },
];

export const CHECK_OUR_WORK: readonly { title: string; detail: string; href: string }[] = [
  { title: "Calibration Scoreboard", detail: "Every typical-move range we state, checked afterwards against what price really did. Live and public.", href: "/calibration" },
  { title: "Methodology", detail: "How each number is produced, in plain language.", href: "/methodology" },
  { title: "Research, including what failed", detail: "Our own tests of what predicts price and what does not. Some results did not go our way, and we publish them.", href: "/resources/research" },
  { title: "Live market pages", detail: "The same context, per instrument, as your clients would see it.", href: "/markets" },
];

export const INSTITUTION_LIMITS: readonly string[] = [
  "We are not a signal service and we do not give buy or sell recommendations. Everything is context, with its limits stated.",
  "How AI-generated market content is classified (information, research or a recommendation) depends on your regulator. That is your compliance team's call, and we will work with you and with counsel on the wording before anything goes to clients.",
  "We are not a market-data vendor and we do not resell raw quotes. What can be shown to your clients depends on the data licences involved.",
  "There is no uptime or service-level agreement yet. The calibration record is short (the public scoreboard started in October 2026), and we say so.",
  "We make no claim about returns, assets or clients.",
];

export const INSTITUTION_PILOT_STEPS: readonly { title: string; detail: string }[] = [
  { title: "Tell us your setup", detail: "Who you are, where your clients are and who regulates you, your platform or app, and what you give clients today." },
  { title: "Pick one thing to try", detail: "One offer, for a small group of clients or a short period, in a form your compliance team has reviewed." },
  { title: "Review together", detail: "What clients used, what your team thought, and whether it is worth building further for you." },
];

export const INSTITUTION_PILOT_QUESTIONS = [
  "Company name and website:",
  "Regulator and jurisdictions you serve:",
  "Platform(s) or app you use:",
  "Which offer interests you most:",
  "How you would like to receive it (widget, API, content feed):",
  "Languages your clients use:",
];
