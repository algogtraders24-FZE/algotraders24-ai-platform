# POLICY CHANGE 2026-11-19 - trade plans and signals are allowed

**Decision (owner, 2026-11-19):** the earlier rule "the platform never generates a trade signal, target price, stop loss or win-rate claim" is **removed**. It blocked product work (the code agents and the validators refused every change that showed an entry, stop or target). The platform may now show trade plans and signals: direction, entry, stop, target, a score, and the plan's measured record.

This document supersedes every earlier statement of the old rule, wherever it appears (see the list at the end). Where an older spec says "never a signal / target / stop / win-rate / buy-sell instruction", read it as **superseded in that respect**; the rest of that spec (data contracts, evidence, audit trail) is unchanged.

## What is allowed now
- Trade plans and signals on the chart and in the dashboard: direction, entry, stop, target(s), R:R, lots for a chosen risk %, a score, "stand aside" when there is no setup.
- The AI assistant may state a plan that comes from the plan engine, with the evidence behind it and the risk.
- Auto-run and alerts of strategies (execution on a user's account only with the user's explicit action or authorization).
- Words like Buy, Sell, Entry, Exit, Target, Stop Loss as normal trading vocabulary.

## Guardrails that stay (honesty and consumer protection)
1. **No promises:** the phrases Guaranteed, Guaranteed Profit, Risk Free, Sure Shot, 100% Accuracy stay forbidden (`lib/ai/terminology.ts`, scanned by `scripts/validate-ai-response-compliance.ts`).
2. **No invented numbers:** a win rate, hit rate, average result or profit figure is shown only when it is measured, with its sample size, period and costs (the AT24 indicator-series standard). No template "55% win-rate" labels. Below 30 trades: "too few", no claim.
3. **Risk and disclaimer on every plan:** stop distance in price and percent, and the "not financial advice, past results do not predict future results" notice.
4. **Source shown:** every plan names the rule set or model it comes from (for example AT24 Position Map plan, AT24 Strategy Fit, AT24 Regime AI range).
5. **Execution is the user's action:** no order is placed on a user's account without an explicit user action or an explicit, revocable authorization.
6. **Constrained agents unchanged:** the support agent and the research agents of the agent framework keep their output-integrity rules (`services/agent-framework/integrity/output-integrity.ts`) because they are not the plan engine; changing them needs a separate decision.

## Code changed by this decision
- `lib/ai/terminology.ts`: removed Buy Now, Sell Now, Best Entry, Entry, Exit, Target, Stoploss, Stop Loss from the forbidden list.
- `lib/ai/response-policy.ts`: the AI may state a trade plan with evidence, risk and measured record; no invented numbers.
- Banners added to the older specs that carried the old rule.

## Specs that carried the old rule (now superseded in that respect)
Listed by the banner each file received at its top.
- `AI_RESPONSE_GUIDELINES.md`
- `AUTOMATION_ARCHITECTURE.md`
- `AUTOMATION_P2_DELIVERY.md`
- `D2.5.2-market-state-regime-spec.md`
- `D2.5.3-hypothesis-engine-spec.md`
- `D2.5.5-intelligence-score-spec.md`
- `D2.6.1-trader-decision-context-spec.md`
- `D2.6.10-verified-intelligence-workspace-spec.md`
- `D2.6.11-universal-instrument-workspace-spec.md`
- `D2.6.2-intelligence-query-context-spec.md`
- `D2.6.5-realtime-intelligence-spec.md`
- `D2.6.9-intelligence-audit-explainability-spec.md`
- `D2.7.1-financial-typography-spec.md`
- `D2.7.11-native-chart-mt5-feature-parity-roadmap.md`
- `D2.7.3-native-chart-production-spec.md`
- `D2.7.4-native-chart-verification-ux-spec.md`
- `D2.7.6-native-chart-professionalization-spec.md`
- `D2.8.0-market-data-capability-audit.md`
- `D2.8.1-market-data-integrity-cleanup-spec.md`
- `D2.8.11-microstructure-evidence-fusion-spec.md`
- `D2.8.13-microstructure-production-wiring-spec.md`
- `D2.8.14-historical-microstructure-validation-spec.md`
- `D2.8.15-intelligence-data-sufficiency-spec.md`
- `D2.8.2-market-microstructure-provider-capability-audit.md`
- `D2.8.3-angel-binance-microstructure-poc.md`
- `D2.8.5-microstructure-intelligence-foundation-spec.md`
- `D2.8.6-binance-microstructure-production-integration-spec.md`
- `D2.8.7-microstructure-intelligence-context-spec.md`
- `D2.8.8-microstructure-intelligence-presentation-spec.md`

Not changed (constrained agents, rule 6): AN1.7, AN1.10, AN1.13, AN1.14, AN1.15 (agent framework), CS1.2, SUPPORT_GENERATIVE_ANSWER_RND, WHATSAPP_SUPPORT_BOT (support).
