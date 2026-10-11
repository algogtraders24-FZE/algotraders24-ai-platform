// lib/rewards/guide.ts
// (Pure - text only.) The Algo Contracts user guide. One source for the guide page and the purchase email, so they can never
// disagree. Plain wording, no promises about results, none of the words in BANNED_COPY_WORDS (checked by validate-rewards).
// It describes only what the system really does; product-specific EA setup notes ship inside the product download.

export interface GuideSection {
  id: string;
  title: string;
  body: string[];
}

export const GUIDE_PATH = "/dashboard/algo-contracts/guide";

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "what-you-bought",
    title: "What you bought",
    body: [
      "A 12-month licence to one AT24 AI Algo (BTC, Gold or Index) for MetaTrader, with the product files and a signed licence.",
      "The price you paid is fixed in your contract. A fixed rebate on that price is credited in 4 quarterly instalments, shown in your contract and on the Algo Contracts page with the exact dates.",
      "The rebate is a price adjustment. It does not depend on trading results, on AT24 revenue, or on any other customer.",
    ],
  },
  {
    id: "get-started",
    title: "Get started in 4 steps",
    body: [
      "1. Open Algo Contracts in your dashboard and press Download product on your contract (your licence details are under Licenses).",
      "2. Install the file in MetaTrader: File > Open Data Folder > MQL5 (or MQL4) > Experts, copy the file in, then restart the platform or refresh the Navigator.",
      "3. Drag the AI Algo onto a chart and switch on Algo Trading. Follow the setup notes included in your download for the settings of that product.",
      "4. Start on a demo account first. Check that it behaves as you expect before using real money.",
    ],
  },
  {
    id: "your-contract",
    title: "Your contract document",
    body: [
      "A PDF copy of your contract was emailed to you when your purchase was confirmed. You can download it again at any time from Algo Contracts, under your contract.",
      "The PDF is a snapshot of the terms that applied on the day you bought. Later changes to our standard terms do not alter it.",
    ],
  },
  {
    id: "rebate",
    title: "How your rebate is credited",
    body: [
      "Each instalment is credited on its due date if you have an active, paid Pro plan and a verified identity (KYC) on that day.",
      "If either is missing on the due date, that instalment is paused and kept for you. It is credited once both are in place again during your contract term. Nothing is removed because of a pause.",
      "Credited amounts show under Your balance. After a 7-day hold they become available to withdraw.",
    ],
  },
  {
    id: "withdraw",
    title: "Withdrawing in USDT",
    body: [
      "Open Your balance on the Algo Contracts page, choose the network (TRC20, ERC20 or BEP20), paste your USDT address and press Withdraw.",
      "The request takes your whole available balance (minimum 50 USD). We pay it by hand after a quick check and add the transaction reference to your request.",
      "Check your address carefully. A transfer to a wrong address cannot be recovered.",
      "Withdrawals need an active Pro plan and a verified identity, both when you ask and when we pay.",
    ],
  },
  {
    id: "referral",
    title: "Your referral link",
    body: [
      "Create your link on the Algo Contracts page. It uses a random code, never your name or username.",
      "When someone you bring buys a contract and the payment is confirmed, you earn a fixed commission shown on your referral card. It becomes available after the 7-day hold and is withdrawn the same way as your rebate.",
      "You cannot earn from your own purchases. Commission is reversed if a purchase is cancelled or refunded as the law requires.",
      "You need an active, paid Pro plan and a verified identity to earn commission.",
    ],
  },
  {
    id: "badge",
    title: "Your diamond",
    body: [
      "While your contract is active you get a diamond next to your name on your Algo Contracts page: blue for BTC, gold for Gold, violet for Index. It is shown only to you and means only that your contract is active.",
    ],
  },
  {
    id: "refunds-risk",
    title: "Refunds and trading risk",
    body: [
      "Sales are final once your licence is issued, except in the cases listed in the refund policy (a duplicate payment, a payment taken without a licence being issued, or a product materially different from its description) and where the law gives you a right that cannot be excluded.",
      "The product is software. We make no promise about trading results. Trading involves a risk of loss, including the loss of your whole account. Never trade money you cannot afford to lose.",
    ],
  },
];

export const GUIDE_FAQ: Array<{ q: string; a: string }> = [
  { q: "Where is my product file?", a: "On the Algo Contracts page, under your contract, press Download product. Your licence is also listed under Licenses." },
  { q: "My instalment shows as paused. What do I do?", a: "Check that your Pro plan is active and your identity is verified. When both are in place the instalment is credited on the next daily check. It is kept for you in the meantime." },
  { q: "Why can I not withdraw?", a: "You need an active Pro plan, a verified identity, and at least 50 USD available after the 7-day hold. The reason is shown on the Your balance card." },
  { q: "Can I get my money back?", a: "Sales are final once your licence is issued, except in the cases in the refund policy. Contact support if you think one of those cases applies to you." },
  { q: "My contract document is still being prepared.", a: "It is created right after the payment is confirmed. If it does not appear within a few minutes, contact support with your order reference." },
  { q: "Who do I contact?", a: "support@algotraders24.ai, or reply to your purchase email." },
];

/** The 4 short steps used in the purchase email (the full guide is one click away). */
export const QUICK_START: string[] = [
  "Open Algo Contracts in your dashboard and press Download product.",
  "Copy the file into your MetaTrader data folder (File > Open Data Folder > MQL5 or MQL4 > Experts) and refresh the Navigator.",
  "Drag the AI Algo onto a chart, switch on Algo Trading, and follow the setup notes in your download. Try it on a demo account first.",
  "Keep your Pro plan active and your identity verified so each rebate instalment is credited on its due date.",
];

/** Everything the guide says, flattened (used by the tests to check the wording). */
export function guideText(): string {
  return [
    ...GUIDE_SECTIONS.flatMap((s) => [s.title, ...s.body]),
    ...GUIDE_FAQ.flatMap((f) => [f.q, f.a]),
    ...QUICK_START,
  ].join("\n");
}
