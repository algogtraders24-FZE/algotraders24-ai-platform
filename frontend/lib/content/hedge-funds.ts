// lib/content/hedge-funds.ts
// Services for funds and allocators (B2B): small and emerging funds, family offices and allocators, mainly in FX, gold, crypto and index markets.
// Deliberately NOT an alpha pitch: our own research found no reliable direction signal in free data, and large funds build their own models.
// What we can credibly offer is governance-friendly evidence tooling, an independent volatility benchmark and a screening aid for track records.
// Same status rule as the other B2B pages: pilot = the pieces exist today and the fund-level version is built with the first fund; coming = not built.
import type { ServiceStatus } from "./prop-firms";

export interface FundService {
  title: string;
  detail: string;
  status: ServiceStatus;
  today: string;
}

export interface FundGroup {
  id: string;
  heading: string;
  services: FundService[];
}

export const FUND_GROUPS: readonly FundGroup[] = [
  {
    id: "analysts",
    heading: "For analysts and risk",
    services: [
      {
        title: "Auditable evidence tools for your AI workflows",
        detail:
          "Let your analysts' AI assistants query market context, the economic calendar and risk maths through a read-only connection, where every number is computed by us, the same inputs give the same answer, and what is unavailable is reported as unavailable.",
        status: "pilot",
        today:
          "A read-only MCP server with nine tools, personal tokens, daily limits and a log of calls exists today (see the Developers page). Fund-level keys and an exportable call log are part of the pilot.",
      },
      {
        title: "Event-aware volatility ranges",
        detail:
          "A typical-move range per instrument that is checked afterwards against what price really did, and that widens when a scheduled release (US CPI, payrolls, a Fed decision) falls inside the window. An independent cross-check for sizing and risk limits.",
        status: "pilot",
        today:
          "Public today on the Markets pages, with the accuracy record on the Calibration Scoreboard. Tested on Gold and Bitcoin; other instruments use those settings untested, and we say so. A fund-keyed feed is part of the pilot.",
      },
    ],
  },
  {
    id: "allocators",
    heading: "For allocators and emerging managers",
    services: [
      {
        title: "Track-record screening aid",
        detail:
          "Read a manager's MetaTrader history: is the result distinguishable from luck, where does it come from, how wide is the spread of outcomes, and do the numbers reconcile with the terminal's own summary.",
        status: "pilot",
        today:
          "Our Edge Analyzer does this per account from an MT5 report or live-synced history, and our Live Results pages show a terminal-reported live record. It is a screening aid, not an administrator's verification or an audit, and a batch workflow is part of the pilot.",
      },
    ],
  },
];

export const FUND_CHECK_OUR_WORK: readonly { title: string; detail: string; href: string }[] = [
  { title: "Calibration Scoreboard", detail: "Every typical-move range we state, checked afterwards against what price really did. Live and public.", href: "/calibration" },
  { title: "Methodology", detail: "How each number is produced, in plain language. The AI only restates a result that was already computed.", href: "/methodology" },
  { title: "Research, including what failed", detail: "We tested whether smart-money structure and CFTC positioning predict price. They did not, and we say so.", href: "/resources/research" },
  { title: "Developers: the MCP server", detail: "Exactly what an AI client can call, with limits, and what it cannot do.", href: "/developers" },
];

export const FUND_LIMITS: readonly string[] = [
  "This is not an alpha pitch. We do not sell signals or trade ideas, and our own tests found no reliable direction signal in free data. What we offer is context, risk and a way to check claims.",
  "The track-record tool is a screening aid. It is not an independent verification, an administrator's report or an audit, and it does not replace them.",
  "Volatility ranges were tested on Gold and Bitcoin only. Other instruments use those settings untested, and the public record is short (the scoreboard started in October 2026).",
  "Figures come from closed trades reported by the manager's own terminal and are not verified by a broker.",
  "We hold no formal security certification yet (such as SOC 2 or ISO 27001). We will answer a vendor due-diligence questionnaire as far as we honestly can.",
  "Everything we use is public or your own. We do not handle material non-public information, and we ask you not to send us any.",
  "There is no uptime or service-level agreement yet, and we make no claim about returns or assets under management.",
];

export const FUND_PILOT_STEPS: readonly { title: string; detail: string }[] = [
  { title: "Tell us your setup", detail: "Your strategy and instruments, where your analysts use AI today, and what your vendor onboarding requires." },
  { title: "Pick one thing to try", detail: "One offer, on a small scope, in a form your compliance and risk teams have reviewed." },
  { title: "Review together", detail: "What your team used and what they would change, and whether it is worth building further for you." },
];

export const FUND_PILOT_QUESTIONS = [
  "Fund or office name and website:",
  "Strategy and instruments (FX, gold, crypto, indices, other):",
  "Trading platform(s) (MT4, MT5, other):",
  "Where your analysts use AI today:",
  "What your vendor onboarding or due-diligence process requires:",
  "Which offer interests you most:",
];
