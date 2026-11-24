# "Build with AI" in the Pro Chart: R&D and a recommended path

Status: R&D note for the owner, 2026-11-24. Nothing here is built. Facts below were checked in the code.

## 1. What a user gets today

The Strategies tab has a **Build with AI** button. It does not stay in the chart: it opens a different page, **Quant Chat** (/dashboard/quant-chat). There the user describes a strategy in plain words, the platform turns it into a strategy specification that the quant engine can run, and a backtest can be started. The same capability also exists inside the chart's own Strategy Tester dialog under the **AI Strategy** tab. Both need a paid plan, and both are limited by the plan's monthly AI credits.

Behind both there are three server pieces: a compile step (words to specification), a run step (specification plus symbol, timeframe and dates to a backtest) and a library where a strategy can be saved (the Gallery).

## 2. What is missing for a good Pro Chart experience

1. **The chart is left behind.** The user loses the symbol, timeframe and context they were looking at and has to repeat them.
2. **The result does not come back to the chart.** The chart can already draw the trades of a finished backtest (the same overlay the Strategy Tester uses), but a strategy built in Quant Chat does not end there.
3. **No next step after a result.** Nothing says "save to Gallery", "run on another symbol" or "watch it live (paper)".
4. **No guidance on what can be built.** The engine supports a defined set of indicators and rule types. A user who asks for something outside it gets an error late, after the AI call has already been paid for.

## 3. Options

| Option | What it is | Effort | Verdict |
|---|---|---|---|
| A. Deep link with prefill | The button opens Quant Chat with the chart's symbol and timeframe already filled in | about half a day | do first, cheap and useful |
| B. Inline builder in the Strategy Tester drawer | A prompt box under the chart: compile, show the compiled rules as a card, "Run on this chart" for up to 2 years, trades drawn on the chart, "Save to Gallery" | 3 to 4 days | the real answer, do second |
| C. Voice build | "PRAGYA, build a strategy that buys when ..." using the existing voice mode feeding option B | 1 day after B | later, a nice demo |
| D. Watching cards and bots | A saved strategy shows as a watching card and can alert or place paper orders | large | belongs to the Advanced plan, not now |

## 4. Recommended path

**Phase 1 (option A):** prefill symbol and timeframe, and show a short "what you can build" list (supported indicators and entry and exit styles) above the prompt, so wrong requests are avoided before any AI cost.

**Phase 2 (option B):** build it inside the drawer. Steps for the user: describe, review the compiled card (plain English rules plus the parameters), choose the window (up to 2 years on H1 and slower, shorter on fast timeframes), run, see the trades on the chart, save. Every result keeps the standing disclosure: no spread or commission, measured on past data, not a prediction.

**Guardrails for both phases:**
- No promise, no win-rate headline, no "best" or "profitable" wording; the result card shows measured numbers only, as the Strategy Tester does today.
- Limits through the same database counter used for Analyze (a daily cap on builds; the free trial users get a small number so they can see it work).
- A compile error is shown in plain words with a suggestion, and does not count against the daily cap.
- The user's own words are never logged outside their own account.

## 5. Cost and risk

- Each build is one AI call plus one backtest. The backtest is the heavier part today (a long window takes about a minute and a half); the shared candle cache proposed in the gating plan fixes this and protects the shared Exness rate limit.
- The compile quality decides whether users trust the feature. Before Phase 2 ships, a fixed set of 30 typical requests (trend follow, mean reversion, breakout, session based) should be run and checked by hand against the compiled rules.

## 6. Questions for the owner

1. Start with Phase 1 only, or go straight to Phase 2?
2. How many builds a day for a free trial user (my suggestion: 3 in the whole trial) and for Pro (my suggestion: 20 a day)?
3. Should a saved strategy be visible to other users in the Gallery, or private by default? (Private is the safe default.)
