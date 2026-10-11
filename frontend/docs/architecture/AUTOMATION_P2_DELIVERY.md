# AUTOMATION_P2_DELIVERY.md - Phase 2: Delivery & Visibility

**Status:** implemented on `feat/automation-p2-delivery`. **No migration.**
**Why:** on 2026-10-12 production showed Automation worked (9/9 scheduled runs
SUCCEEDED, the real cron fires 08:00 IST) but almost nothing reached a user:
results were invisible, the one saved artifact was empty, nothing was sent to
the user, and a template could never fire. Phase 2 makes the output reach the
user's actual work.

## Findings from reading real production runs (the R&D)

| # | Finding | Fix |
|---|---|---|
| 1 | The "Daily Market Brief" template saved the **Research** result: `coverage: no-coverage`, 0 citations, `resolved:false` - i.e. 10 empty artifacts. The real analysis (Market Intelligence: bias, regime, reasons) was never saved or shown. | Templates save the step that holds the analysis (`$.steps.s1.result`). |
| 2 | The "Gold Morning" template's condition tested `$.steps.s1.confidence`. Market Intelligence has `regimeConfidence` (0-100) and `bias`, **no `confidence`** - so the condition always failed closed and the template always halted. | Conditions use the real fields; a test proves they are met by a real confident output and not met by a weak one. |
| 3 | Run Detail showed step status/credits but never the agent's actual conclusion. | `AutomationStepRunView.brief` - a readable summary of the child run's output, computed on read. |
| 4 | The channels already exist: in-app bell (`UserNotification`), Telegram (`services/telegram`), Web Push (`services/push`) - all best-effort and per-user opt-in. | Reused as-is; no new infrastructure. |
| 5 | The builder offered metrics (`confidence`, `status`) that no agent produces and listed forward step references. | Metric pickers list each agent's real fields, scoped to earlier steps only. |

## What was built

- `services/automation/brief.ts` - pure formatter: agent output -> `{headline, lines, disclaimer, empty}`. Re-states only what the agent produced; an output with nothing to report (0 citations, unresolved) is `empty`.
- `services/automation/delivery.ts` (pure) + `delivery-deps.ts` (production wiring) - after a **SUCCEEDED** run, deliver to the channels in `definition.delivery.channels` (`bell` | `telegram` | `push`). Default (field absent) = bell only; `[]` = off. Nothing is sent when every brief is empty. Best-effort: never throws, never changes a run's outcome. Idempotent via the existing `wasAlreadyTerminal` guard. The outcome is recorded in `AutomationRun.contextSnapshot.delivery`.
- `definition.delivery` - optional JSON field (no schema change), validated by the workflow validator.
- `GET /api/private/automations/results` + `ResultsFeed` - "what my automations concluded" (artifacts rendered through the same formatter; empty ones hidden; owner-scoped on artifact and run).
- Builder: "Send me the result" section showing live Telegram / push connection status; real metric pickers; **Edit** (`/dashboard/automation/[id]/edit`) reusing the same builder - saving writes a new immutable version.
- Run Detail renders the readable result; list page shows latest results and a useful empty state.
- Dispatcher also puts `briefText` in the step context, so a publication draft can be built from the agent's real findings (`aiOverviewFrom: $.steps.s1.briefText`).

## Boundaries kept

- Delivery is **decision support only**: every message carries the line "Decision support only, not a trade recommendation. AT24 never trades for you."; nothing says buy/sell; user-controlled text is HTML-escaped for Telegram.
- Telegram/push honour the user's own link and the existing "alerts" switch; a user who never connected them receives nothing there.
- Failures keep their existing email path; conditions that stop a run send nothing (that is how "notify me only when..." works).
- Existing automations and their historical versions are untouched.

## Verification

`validate:automation-brief` 13, `-delivery` 10, existing pure suites 47, `-lifecycle` 19 (DB, synthetic users, cascade cleanup). tsc / eslint clean.

## Not in this phase (evidence-driven, later)

More time slots / a free time picker (needs Vercel Pro), price/news/event triggers, credit reservation + refund, automatic retry, email delivery, Migration B.
