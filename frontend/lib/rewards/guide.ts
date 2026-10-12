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
      "To buy any contract you need an active paid Pro plan and a verified identity (KYC). Do the identity check first, in Settings.",
      "The price you paid is fixed in your contract. A fixed rebate on that price is credited in 4 quarterly instalments, shown in your contract and on the Algo Contracts page with the exact dates.",
      "The rebate is a price adjustment. It does not depend on trading results, on AT24 revenue, or on any other customer.",
    ],
  },
  {
    id: "get-started",
    title: "Get started in 4 steps",
    body: [
      "1. Open Algo Contracts in your dashboard and press Download product on your contract (your licence details are under Licenses).",
      "2. Install the file in MetaTrader. Step by step for MetaTrader 5 and MetaTrader 4 is in the next sections.",
      "3. Allow the AT24 web address once, paste your one licence key into the EA input InpLicenseKey, and switch on Algo Trading (MT5) or AutoTrading (MT4).",
      "4. Start on a demo account first. Check that it behaves as you expect before using real money.",
    ],
  },
  {
    id: "licence-values",
    title: "Your licence key (what to copy)",
    body: [
      "Open Purchases in your dashboard, choose your product, and you will see the download button and your licence details on one page.",
      "You need only one thing: your licence key, a single line that starts with AT24-. On the purchase page press Show / generate my licence key, then Copy. It is shown once, so paste it somewhere safe straight away. If you lose it, generate a new one (the old one stops working).",
      "Paste it into the EA input InpLicenseKey and leave the other four licence rows empty.",
      "Some older products ask for four separate values instead: InpLicenseId, InpApiKey, InpBuyerId and InpReleaseId. They are all on the same page, under Older EAs that ask for separate values. Use them only if your EA has no InpLicenseKey row.",
      "Treat the key like a password. Do not post it or send it to anyone. AT24 will never ask you for it. The key only works for the product you bought, on your own trading account.",
      "By default a licence is tied to one trading account at a time. To move it to another account, contact support.",
    ],
  },
  {
    id: "install-mt5",
    title: "Install in MetaTrader 5",
    body: [
      "1. Download the EA (a file ending in .ex5) from your purchase page.",
      "2. In MetaTrader 5 choose File > Open Data Folder, open the folder MQL5, then Experts, and copy the .ex5 file into it.",
      "3. In the Navigator panel (Ctrl+N) right-click Expert Advisors and choose Refresh. The EA appears in the list.",
      "4. Allow our web address, once: Tools > Options > Expert Advisors, tick Allow WebRequest for listed URL, add https://www.algotraders24.ai and press OK. Do this before step 6, otherwise the licence check fails.",
      "5. Open a chart of the right symbol and timeframe (see the table below). Use one chart per symbol.",
      "6. Drag the EA from the Navigator onto the chart. On the Common tab tick Allow Algo Trading. On the Inputs tab find the group AT24 LICENSE and paste your key into InpLicenseKey. Press OK.",
      "7. Make sure the Algo Trading button in the top toolbar is green. A smiling face or the EA name at the top right of the chart means it is running.",
      "8. Check the Experts tab at the bottom (View > Toolbox). You should see the line AT24 License: activated OK. The panel on the chart shows LIC: OK and ACTIVE.",
    ],
  },
  {
    id: "install-mt4",
    title: "Install in MetaTrader 4",
    body: [
      "1. Download the EA (a file ending in .ex4) from your purchase page. Use the MetaTrader 4 version of your product.",
      "2. In MetaTrader 4 choose File > Open Data Folder, open the folder MQL4, then Experts, and copy the .ex4 file into it.",
      "3. In the Navigator panel (Ctrl+N) right-click Expert Advisors and choose Refresh.",
      "4. Allow our web address, once: Tools > Options > Expert Advisors, tick Allow WebRequest for listed URL, add https://www.algotraders24.ai and press OK. Do this before step 6.",
      "5. Open a chart of the right symbol and timeframe (see the table below). Use one chart per symbol.",
      "6. Drag the EA onto the chart. On the Common tab tick Allow live trading. On the Inputs tab paste your key into the InpLicenseKey row of AT24 LICENSE. Press OK.",
      "7. Make sure the AutoTrading button in the toolbar is green, and that the face at the top right of the chart is smiling.",
      "8. Check the Experts tab at the bottom (View > Terminal). You should see AT24 License: activated OK. The panel on the chart shows LIC: OK and ACTIVE.",
      "9. For the statistics on the panel to cover all your trades, open the Account History tab, right-click and choose All History.",
    ],
  },
  {
    id: "per-product",
    title: "Symbol and timeframe for each product",
    body: [
      "Index AI Algo: the index symbol of your broker (for example US30 or the name your broker uses), timeframe M15. Give each index chart its own InpMagicNumber.",
      "BTC AI Algo: BTCUSD, timeframe H1. It trades around the clock.",
      "Gold AI Algo: XAUUSD or GOLD, timeframe M15. It adjusts itself for brokers with 2 or 3 decimals.",
      "The settings in the EA are starting values, not recommendations. Change risk settings only if you understand them. The default lot is 0.01.",
      "Stop loss and take profit are set by the EA in each order. The EA also moves the stop to break even and trails it, and pauses itself during the weekend and when the spread is too wide.",
    ],
  },
  {
    id: "check-working",
    title: "How to tell it is working",
    body: [
      "The panel on the chart shows LIC: OK and ACTIVE. NOT LICENSED means the licence check failed.",
      "The EA places pending orders when a new bar opens, only in the direction of the trend, and not on weekends or when the spread is wide. It is normal to see no orders for hours.",
      "Orders are replaced on each new bar, so you may see a pending order appear and disappear. That is expected.",
      "Keep the terminal running. The EA works only while MetaTrader is open and connected. Many users run it on a VPS.",
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
  { q: "The Experts tab says WebRequest failed (error 4060 or 4014).", a: "The AT24 address is not allowed yet. Go to Tools > Options > Expert Advisors, tick Allow WebRequest for listed URL, add https://www.algotraders24.ai, press OK, then remove the EA from the chart and attach it again." },
  { q: "It says NOT licensed and the EA stops.", a: "The key is missing, wrong, or belongs to another product. Press Show / generate my licence key on your purchase page, copy the new key, paste it into InpLicenseKey, and attach the EA again. Make sure you are using the EA you bought, on the right platform (MT5 or MT4)." },
  { q: "Activation rejected: account limit reached.", a: "The licence is already active on another trading account. Free the slot from your purchase page or contact support." },
  { q: "The EA is on but no orders appear.", a: "That is often normal. Check that the spread is not wide, that it is not the weekend pause (Friday evening to Monday morning, server time), that the trend filter agrees with a direction, that you have free margin, and that the daily trade limit is not reached. Make sure the symbol and timeframe match your product." },
  { q: "MetaTrader 4 shows no statistics on the panel.", a: "Open the Account History tab, right-click and choose All History." },
  { q: "Can I run it on several charts or accounts?", a: "One chart per symbol, each with its own InpMagicNumber. A licence is active on one trading account at a time by default." },
  { q: "Who do I contact?", a: "support@algotraders24.ai, or reply to your purchase email." },
];

/** The 4 short steps used in the purchase email (the full guide is one click away). */
export const QUICK_START: string[] = [
  "Open Algo Contracts in your dashboard and press Download product.",
  "Copy the file into your MetaTrader data folder (File > Open Data Folder > MQL5 or MQL4 > Experts), refresh the Navigator, and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors.",
  "Drag the EA onto a chart, paste your licence key (from your purchase page) into InpLicenseKey, and switch on Algo Trading. Try it on a demo account first. The guide has the exact steps for MT5 and MT4.",
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
