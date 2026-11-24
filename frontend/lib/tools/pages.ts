// lib/tools/pages.ts
// Content of the free public tools pages (/tools and /tools/[slug]). Plain, education-only wording: arithmetic, no advice, no promises.

export interface ToolPageDef {
  slug: string;
  title: string; // <title> and H1
  short: string; // card title on the hub
  description: string; // meta description (70-160 chars)
  intro: string;
  how: string[];
  faq: { q: string; a: string }[];
  videoHint: string;
}

export const TOOL_PAGES: readonly ToolPageDef[] = [
  {
    slug: "position-size-calculator",
    title: "Forex and Gold Position Size Calculator",
    short: "Position size calculator",
    description: "Free position size calculator for forex and gold: enter your balance, risk percent and stop-loss in pips and get the lot size. No login needed.",
    intro: "Position sizing answers one question before every trade: how many lots can I trade so that, if the stop-loss is hit, I lose only the amount I chose? Enter your balance, the percent you accept to risk and the stop distance in pips.",
    how: [
      "Amount at risk = balance x risk percent.",
      "Lot size = amount at risk / (stop distance in pips x value of one pip per lot).",
      "The size is rounded down to the 0.01 lot step, so the real risk is never above your limit.",
    ],
    faq: [
      { q: "How do I calculate position size in forex?", a: "Multiply your balance by the risk percent to get the amount at risk, then divide it by the stop-loss distance in pips times the pip value of one lot. The calculator above does these steps for you." },
      { q: "What risk percent per trade do traders use?", a: "Many educational sources suggest keeping the risk on each trade small, often between 0.5 and 2 percent of the account. The right number depends on your own plan and tolerance, and nothing here is advice." },
      { q: "Why is the lot size rounded down?", a: "Most platforms trade in steps of 0.01 lot. Rounding up would make the loss at the stop larger than the amount you chose, so the calculator rounds down." },
      { q: "Does this work for gold?", a: "Yes. For gold, one standard lot is 100 ounces and one pip is a 0.10 price move on most brokers, which is 10 dollars per pip per lot. Confirm the contract size with your broker." },
    ],
    videoHint: "Position size from your risk limit",
  },
  {
    slug: "pip-value-calculator",
    title: "Pip Value Calculator for Forex and Gold",
    short: "Pip value calculator",
    description: "Free pip value calculator: see what one pip is worth in USD for EUR/USD, GBP/USD, USD/JPY, gold and more, for any lot size. No login needed.",
    intro: "A pip is the standard small price step. What it is worth in money depends on the instrument and on your position size. Pick the instrument and the lots to see the value of 1, 10 and 50 pips.",
    how: [
      "Pip value per lot = pip size x contract size. For pairs quoted in USD this is already in dollars.",
      "For pairs where USD is the first currency (USD/JPY, USD/CHF, USD/CAD) the value is in the other currency, so it is divided by the pair's current price to get dollars.",
      "Multiply by the number of lots for your position.",
    ],
    faq: [
      { q: "How much is one pip worth on EUR/USD?", a: "For one standard lot (100,000 units) one pip is 10 US dollars. For 0.1 lot it is 1 dollar and for 0.01 lot it is 10 cents." },
      { q: "Why does the USD/JPY pip value change?", a: "A USD/JPY pip is 0.01 and is worth 1,000 yen per lot. Converting yen to dollars uses the current price, so the dollar value moves a little as the price moves." },
      { q: "What is a pip on gold?", a: "Definitions differ between brokers. A common one is a 0.10 move in the price of XAU/USD, which is 10 dollars per pip for one lot of 100 ounces. Check your platform." },
    ],
    videoHint: "What a pip is worth",
  },
  {
    slug: "risk-reward-calculator",
    title: "Risk Reward Ratio Calculator",
    short: "Risk reward calculator",
    description: "Free risk reward calculator: enter entry, stop-loss and take-profit to see the risk to reward ratio and the break-even win rate. No login needed.",
    intro: "The risk to reward ratio compares how much you can lose on a trade with how much you aim to gain. Enter the entry, the stop-loss and the take-profit price to see the ratio and the break-even win rate.",
    how: [
      "Risk = distance from entry to stop. Reward = distance from entry to target.",
      "Ratio = reward / risk. A ratio of 2 is written 1 : 2.",
      "Break-even win rate = risk / (risk + reward): the share of trades that must reach the target to break even before costs.",
    ],
    faq: [
      { q: "What is a good risk to reward ratio?", a: "There is no single good number. A higher ratio needs fewer winning trades to break even, but price also reaches a farther target less often. Use the ratio as one input in your own plan." },
      { q: "What does break-even win rate mean?", a: "It is arithmetic: with a 1 : 2 plan, you break even if one trade in three reaches the target, before spread and commission. It says nothing about how often trades will actually succeed." },
      { q: "Does it work for short trades?", a: "Yes. For a short, the stop is above the entry and the target is below it. The calculator detects the direction." },
    ],
    videoHint: "Risk to reward in 60 seconds",
  },
  {
    slug: "drawdown-recovery-calculator",
    title: "Drawdown Recovery Calculator",
    short: "Drawdown recovery calculator",
    description: "Free drawdown recovery calculator: see the gain needed to recover a loss and what a losing streak does to your balance at your risk per trade.",
    intro: "Losses and gains do not cancel out. After losing 50 percent of an account you need to gain 100 percent to get back. Enter a drawdown, or see how a losing streak affects a balance at your chosen risk per trade.",
    how: [
      "Gain needed = 1 / (1 - loss) - 1. A 20 percent loss needs a 25 percent gain.",
      "A losing streak is computed trade by trade: each loss is a percent of the current balance, so the balance falls a little less each time.",
      "This is arithmetic about risk, not a forecast of any streak.",
    ],
    faq: [
      { q: "Why does a 50 percent loss need a 100 percent gain?", a: "After the loss you hold half the money, so you must double what is left to reach the starting balance." },
      { q: "How many losing trades in a row are possible?", a: "Any run is possible in any strategy. The table shows what each run would do to the balance so you can choose a risk per trade you can live with." },
    ],
    videoHint: "Drawdown and recovery",
  },
];

export function getToolPage(slug: string): ToolPageDef | undefined {
  return TOOL_PAGES.find((t) => t.slug === slug);
}
