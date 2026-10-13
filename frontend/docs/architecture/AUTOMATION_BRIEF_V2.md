# Automation Brief v2 + Macro Alignment (gold)

Follow-up to `AUTOMATION_P2_DELIVERY.md`. Phase 2 delivered results; users found the text unreadable
("regime low-volatility (confidence 100)") and repetitive. Brief v2 makes the delivered result plain,
adds context, and stays silent when nothing changed. Competitor R&D (distinction.ae, 2026-10-12): their
"Macro Conviction %" has no published method; ours is a documented, auditable rule.

## What changed

| Area | Change |
|---|---|
| `services/automation/brief.ts` | Plain-language Market Intelligence headline (`Gold (XAUUSD 1h): leaning bullish - trending up`); jargon basis lines dropped; optional `previous` output -> `changed` + `changeNote` |
| `types/automation.ts` | `AutomationDeliveryConfig.mode?: "always" \| "on_change"`; `AgentBrief.changed/changeNote` |
| `services/automation/delivery.ts` | `on_change` skips (reason `no-change`) when every comparable brief is unchanged. First run / non-comparable briefs count as changed. `deps.enrich` adds extras for gold MI only |
| `services/automation/brief-extras.ts` (pure) | price line, today's high-impact events in IST with countdown |
| `services/automation/delivery-deps.ts` | production `enrich`: macro snapshot + USD high-impact calendar. Each part best-effort |
| `services/automation/dispatcher.ts` + repository | loads the previous SUCCEEDED run's agent outputs for the comparison |
| templates | Gold Morning Intelligence + Evening Outlook Draft deliver `on_change`; Daily Market Brief stays `always` |
| Builder | "Only notify me when something changed" toggle |
| `services/macro/*`, `/api/private/macro-alignment`, `components/macro/MacroAlignmentCard.tsx` | Macro Alignment gauge card on `/dashboard/automation` |

No migration, no new tables, no new cron.

## Macro Alignment - the formula (shown on the card)

Five drivers, each reads +1 (supports gold), -1 (headwind) or 0 (neutral); missing data is dropped, never estimated.

| Driver | Weight | Source | Rule |
|---|---|---|---|
| Real yield | 30 | FRED DFII10 (needs `FRED_API_KEY`) | 5-obs change <= -0.05pp: +1; >= +0.05pp: -1 |
| US dollar | 20 | Twelve Data UUP (proxy) | day change <= -0.15%: +1; >= +0.15%: -1 |
| Treasury yields | 15 | Twelve Data IEF (proxy) | day change >= +0.15%: +1; <= -0.15%: -1 |
| Risk sentiment | 10 | Twelve Data VIXY (proxy), day change only | >= +2%: +1, else 0 (calm is never a headwind) |
| Gold momentum | 25 | Twelve Data XAU/USD | >= +0.3%: +1; <= -0.3%: -1 |

* Lean = sign of the weighted sum. Score = share of available weight pointing the same way as the lean.
* Under 3 available drivers -> no score. A lean backed by under 50% of the weight is labelled "Mixed".
* NOT a forecast or probability. Weights are a research-based choice (real yields and dollar are the most-cited
  gold drivers), not a proven edge. The card says so.
* Proxies are labelled as proxies. VIXY decays, so only its day change is used.
* VIX itself is not used: FRED's VIXCLS is CBOE-copyrighted.
* FRED attribution is shown whenever the real-yield driver contributes (FRED API terms).
* Twelve Data Basic = 8 req/min; one snapshot is 4 quotes, cached 5 minutes in-process.

## Tests

`npm run validate:macro-alignment` (scoring, fetch degrade paths, cache, IST events), `validate:automation-brief`,
`validate:automation-delivery`, lifecycle + `validate:automation-p2-smoke` (real DB, synthetic users).
