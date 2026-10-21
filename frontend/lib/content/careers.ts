// lib/content/careers.ts
// Careers data. Edit THIS file to open, close or change a role - the page just renders it.
// Pay is quoted in USD per month and is indicative (it depends on experience); confirm before publishing changes.

export interface OpenRole {
  id: string;
  title: string;
  summary: string;
  type: string;
  location: string;
  pay: string;
  responsibilities: string[];
  musts: string[];
  nice: string[];
  first90: { when: string; goal: string }[];
}

export interface FutureRole {
  title: string;
  why: string;
  when: string;
}

export const APPLY_EMAIL = "support@algotraders24.ai";

export const OPEN_ROLES: readonly OpenRole[] = [
  {
    id: "full-stack-engineer",
    title: "Full-Stack Engineer (product and operations)",
    summary: "Keep a live trading-intelligence platform running well, make it safer, and ship what is on the roadmap.",
    type: "Contract trial (2-3 months), then full-time if we both want it",
    location: "Remote, based in India",
    pay: "USD 700 - 1,400 per month, depending on experience; paid monthly in USD",
    responsibilities: [
      "Own the day-to-day health of the product: fix bugs, answer alerts, deploy safely.",
      "Add the safety net we are missing: error monitoring, automated tests in CI and rate limiting on AI and backtest endpoints.",
      "Work with Next.js, TypeScript, PostgreSQL (Prisma) and some Python services and MetaTrader tooling.",
      "Ship roadmap features with the founder, with clear written notes on every change.",
      "Handle payments and licence webhooks carefully; money-touching code gets extra review.",
    ],
    musts: [
      "3+ years building and running production web apps in TypeScript, React and Next.js.",
      "Solid SQL and PostgreSQL; comfortable reading and writing migrations.",
      "Git and pull-request habits; you write down what you changed and why.",
      "You have handled a production incident and can describe what you learned.",
      "Clear written English.",
    ],
    nice: [
      "MetaTrader 4/5 or MQL5 experience.",
      "Python, and some Windows server administration.",
      "Experience with payment webhooks, Vercel and Supabase.",
      "Interest in trading or fintech.",
    ],
    first90: [
      { when: "First 30 days", goal: "Set up the project, read the code and docs, fix a few small bugs, and learn how releases and alerts work. Read-only access to production data at first." },
      { when: "Days 30-60", goal: "Add error monitoring and a basic CI pipeline (lint, typecheck, build and a few critical tests)." },
      { when: "Days 60-90", goal: "Add rate limiting and per-user quotas on the costly endpoints, and deliver one roadmap feature end to end." },
    ],
  },
  {
    id: "growth-community-manager",
    title: "Growth and Community Manager",
    summary: "Bring in our first real users and sellers, and turn what they say into a better product.",
    type: "Contract trial (3 months), then full-time if we both want it",
    location: "Remote, based in India",
    pay: "USD 450 - 850 per month, depending on experience; paid monthly in USD",
    responsibilities: [
      "Find and bring in our first 10-20 real users, and collect structured feedback from each: what they tried, what they expected, what happened.",
      "Run content and distribution: our daily market reports, the blog, Telegram and social posts (drafts are reviewed before they go out).",
      "Talk to EA and indicator developers and help the right ones list on the marketplace.",
      "Look after the community on Telegram.",
      "Send the founder a short weekly report with real numbers.",
    ],
    musts: [
      "2+ years in marketing, content or community for trading, forex, crypto or fintech audiences.",
      "Strong writing in English; Hindi is a plus.",
      "You understand traders and their language, and you will never promise profits or returns. Every claim we make must be true and checkable.",
      "You are comfortable doing direct, personal outreach.",
    ],
    nice: ["SEO and content-led growth.", "Existing contacts among EA developers or trader communities.", "Experience with MQL5.com, TradingView or Telegram groups."],
    first90: [
      { when: "First 30 days", goal: "Learn the product and the honest-claims rule. Build a list of where our users are and a plan to reach them." },
      { when: "Days 30-60", goal: "Start outreach. First real users in, with feedback written up." },
      { when: "Days 60-90", goal: "10-20 real users with structured feedback, a repeatable weekly routine, and the first conversations with outside sellers." },
    ],
  },
  {
    id: "support-operations-associate",
    title: "Support and Operations Associate (part-time)",
    summary: "Be the human behind our support: answer what the AI cannot, and keep the day-to-day operations tidy.",
    type: "Part-time, about 20 hours a week; can grow into full-time as we grow",
    location: "Remote, based in India",
    pay: "USD 170 - 300 per month, depending on hours and experience; paid monthly in USD",
    responsibilities: [
      "Answer support requests that our AI Copilot hands over to a person, by email and chat, clearly and kindly.",
      "Check identity-verification and marketplace-report queues, following written rules.",
      "Prepare payout and withdrawal requests for approval. Approval stays with the founders.",
      "Help new sellers list their products.",
      "Keep our knowledge-base articles up to date from what customers actually ask.",
    ],
    musts: [
      "Clear, polite written English.",
      "Careful with detail and honest with customer information; you will see sensitive data and must keep it private.",
      "Basic understanding of trading, MetaTrader and what an Expert Advisor is.",
      "Reliable and responsive during agreed hours.",
    ],
    nice: ["Previous support or operations experience, ideally in fintech or trading.", "Hindi in addition to English.", "Familiarity with KYC or payments operations."],
    first90: [
      { when: "First 30 days", goal: "Learn the product and the support rules. Handle tickets with a founder reviewing replies." },
      { when: "Days 30-60", goal: "Handle the handoff queue on your own and update the knowledge base from recurring questions." },
      { when: "Days 60-90", goal: "Run the weekly operations checklist (reports, verification queue, payout preparation) with no reminders." },
    ],
  },
];

export const FUTURE_ROLES: readonly FutureRole[] = [
  { title: "Quant / MQL5 developer (contract)", why: "Validate Expert Advisors and build new products for the marketplace.", when: "As the marketplace grows" },
  { title: "Product designer (part-time)", why: "Keep the product clear and consistent as it gets bigger.", when: "As the marketplace grows" },
  { title: "Second support associate", why: "Cover more hours and more languages as users grow.", when: "When support volume needs it" },
  { title: "Product analyst", why: "Turn usage and research into decisions for professional tools and prop-firm features.", when: "Professional phase" },
  { title: "Compliance advisor", why: "Keep us right with the rules in the markets we serve.", when: "Professional phase" },
  { title: "Developer relations engineer", why: "Help developers build on our API and MCP server.", when: "Developer phase" },
  { title: "B2B sales and partnerships", why: "Bring our evidence tools to firms and institutions.", when: "Institutional phase" },
];
