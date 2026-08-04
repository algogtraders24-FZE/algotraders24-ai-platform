# AI Response Guidelines

Sprint D2.3.S4 — the platform's single, canonical communication standard for every AI-generated response, across every current and future module (AI Assistant, Publishing, Market Intelligence, Trading Copilot / Intelligence Panel, and any later Research or Intelligence Engine v2 surface).

**This document is not aspirational.** It documents the actual enforced code in `lib/ai/`:

| Module | Purpose |
| --- | --- |
| `lib/ai/response-policy.ts` | `AI_COMMUNICATION_POLICY` — the prompt text sent to the model at every AI entry point |
| `lib/ai/terminology.ts` | `FORBIDDEN_PHRASES` / `APPROVED_LANGUAGE` — the single word/phrase registry |
| `lib/ai/compliance.ts` | `CONFIDENCE_SCALE` and `scanForForbiddenLanguage()` — confidence-band interpretation and the automated compliance scanner |
| `lib/ai/disclaimer.ts` | `AI_DISCLAIMER_TEXT` — the one canonical disclaimer sentence |

`response-policy.ts` *composes* its prompt text from `terminology.ts` and `compliance.ts` rather than restating them — the forbidden-phrase list and confidence bands exist in exactly one place, so the model instruction, the automated scanner in `scripts/validate-ai-response-compliance.ts`, and this document can never drift apart. A new AI module should import these modules, not write its own version of any of this.

## 1. Platform Philosophy

The platform is a **trading intelligence platform**, not a signal service. Every response follows the same shape:

```
Observe → Analyze → Explain → Highlight Risks → Offer Scenarios → User Decides
```

The AI observes evidence, explains what it means and why, states what could go wrong, and offers scenarios — it never tells the user what to do. The user always decides. Tone: professional financial intelligence — the register a research desk would use. Not a social-media caption, not a signal-group alert, not marketing copy. No exaggerated certainty, no hype adjectives, no urgency framing ("don't miss this").

## 2. Approved Language

Prefer hedged, evidence-based phrasing (`APPROVED_LANGUAGE` in `terminology.ts`):

- "Bullish scenario" / "Bearish structure"
- "Higher-probability conditions"
- "Evidence suggests..."
- "Market conditions indicate..."
- "Current evidence favors..."
- "Conditions are consistent with..."

## 3. Forbidden Language

`FORBIDDEN_PHRASES` in `terminology.ts` — never used as a directive to the user, outside an explicitly-labeled educational example (e.g. "a stop-loss order is a type of order that... — here's what one looks like"):

| Forbidden | Alternative | Auto-scanned |
| --- | --- | --- |
| Buy Now | Bullish scenario | Yes |
| Sell Now | Bearish structure | Yes |
| Guaranteed Profit | — | Yes |
| 100% Accuracy | — | Yes |
| Sure Shot | — | Yes |
| Risk Free | — | Yes |
| Guaranteed | — | Yes |
| Best Entry | Higher-probability conditions | Yes |
| Entry / Exit / Target / Stoploss / Stop Loss | — (context-dependent) | No — legitimate in an educational definition, so only the AI's own instruction and human review catch a directive misuse, not the automated scanner |

Also never: emoji, or a bare "100%" used as a certainty/confidence claim.

## 4. Risk Communication

Every market analysis consistently states, when the underlying data contains it:

- Market uncertainty
- Risk factors
- Missing or insufficient evidence
- Data freshness (as-of / computed-at time)
- Provider status, when degraded (see `components/workspace/ProviderStatus.tsx`)

These are never silently omitted because omitting them would look more confident — an honest "no specific risk factors were flagged" fallback is used when a field would otherwise render blank (see `IntelligencePanel.tsx`'s risk-explanation handling).

## 5. Confidence Rules

Confidence describes **how certain the analysis is** — how much evidence exists and how well it agrees — **never** a probability that a trade will succeed. Format:

```
AI Confidence
88%
Based on: Trend, Momentum, Volatility, Market Structure, Evidence
```

The "Based on" list only names factors genuinely present in that specific response — never a fixed list applied regardless of what was actually available (`components/workspace/IntelligencePanel.tsx`'s `confidenceBasis` is the reference implementation).

`CONFIDENCE_SCALE` in `lib/ai/compliance.ts` — one interpretation for every confidence number shown anywhere on the platform:

| Range | Label | Meaning |
| --- | --- | --- |
| 0–40 | Weak evidence | Little supporting evidence, or evidence that conflicts significantly. |
| 41–60 | Mixed evidence | Some supporting evidence exists, but it is incomplete or partially contradicted. |
| 61–80 | Moderate evidence | A reasonable body of evidence agrees, with some gaps or minor disagreement. |
| 81–100 | Strong evidence | Substantial, consistent evidence supports the analysis. |

## 6. Disclaimer Rules

One canonical sentence, `AI_DISCLAIMER_TEXT` in `lib/ai/disclaimer.ts`, rendered via `components/ui/Disclaimer.tsx` — never a re-typed string. Shown on every analysis-shaped surface: Market Intelligence results, the Workspace Intelligence Panel, Trading Copilot results, and Publishing articles (the same constant is the persisted `disclaimer` field on every generated article). Not bolted onto every casual chat turn — see §8.

## 7. Educational Responses

Technical concepts (Break of Structure, Change of Character, Order Block, Liquidity, Fair Value Gap) may carry an optional inline definition via the existing `InfoTooltip` component and the `data/educational-terms.ts` glossary — wherever the term already appears in the UI. This is presentation only; it never changes what the AI reasons about or how a value is computed. In a chat reply, a directive word like "stop-loss" or "entry" is permitted only when the response is explicitly explaining the concept, not instructing the user to place one.

## 8. Market Analysis Responses

Structured around Observe → Analyze → Explain → Highlight Risks → Offer Scenarios (§1). Always includes the disclosures in §4. Carries the disclaimer (§6). The AI is a translator of already-computed, deterministic evidence/risk/confidence data — it never invents a fact, price, or conclusion not already present in that data (unchanged, pre-existing rule in every restatement prompt).

## 9. Publishing Guidelines

Draft prompts (`app/dashboard/publishing/page.tsx`) require: hedged, evidence-based language (never a directive like "Buy Gold"), a one-line risk disclaimer, and inherit `AI_COMMUNICATION_POLICY` from the shared chat route they're generated through. The persisted `disclaimer` field on every article is `AI_DISCLAIMER_TEXT` (`services/ai/publishing/content-generator.service.ts`), never a separately-typed string.

## 10. Examples — Good vs Bad

| Bad (directive / hyped) | Good (hedged / evidence-based) |
| --- | --- |
| "Buy Gold now." | "Current evidence favors a bullish scenario for gold." |
| "Sell EURUSD, guaranteed profit." | "Current conditions are consistent with bearish market structure. This is not a guarantee." |
| "100% confidence — sure shot trade." | "AI Confidence 82% based on: Trend, Momentum, Evidence." |
| "🚀 Massive breakout incoming!!" | "Price has moved beyond a recent high, which is often studied as a possible continuation signal." |
| "Best entry is 1.0850, target 1.0920." | "Higher-probability conditions sit near 1.0850, based on the evidence above — this is not a specific trade instruction." |

## Where this is enforced

| Entry point | File |
| --- | --- |
| AI Assistant / Research (RAG chat) | `app/api/private/knowledge/chat/route.ts` |
| Market Intelligence restatement | `services/ai/market-analysis-orchestration.service.ts` |
| Trading Copilot / Intelligence Panel restatement | `services/ai/market-context-builder.service.ts` |
| Publishing draft generation | `app/dashboard/publishing/page.tsx` |

All four import `AI_COMMUNICATION_POLICY` from `lib/ai/response-policy.ts`. A future module should do the same rather than writing its own version of this policy.
