# AT24_GOLD_G01_LiquiditySweep_MSS_FVG

**Algotraders24 AI — Independent Gold EA Research Series**
EA ID: `G01` | Version: `v0.1 — Frozen Research Baseline` | Instrument: `XAUUSD` | Platform: `MetaTrader 5 / MQL5`

This is a research baseline, not a trading recommendation. It is not a claim that the
strategy is profitable, that ICT/SMC concepts are institutionally proven, or that XAUUSD
will achieve any particular win rate. The objective of v0.1 is **accurate implementation +
non-repainting + reproducible backtest + complete telemetry**. Do not optimize this build —
see [Control Experiments](#control-experiments--future-forks) for how later research should
branch off instead of mutating this frozen baseline.

This EA is one independent strategy. It does not read signals from other EAs, other AT24
strategies, external AI, ML models, sentiment, order-book data, or manual input — only
MT5's own market data and the rules below.

---

## 1. Strategy Sequence

```
VALID LIQUIDITY → SWEEP → DISPLACEMENT → MSS → FVG → RETEST → ENTRY
```

Every stage must complete, in order, on **closed candles only**, before the next stage is
even searched for. The EA never looks for an FVG before MSS has confirmed, never looks for
MSS before displacement has confirmed, etc.

| Timeframe | Role |
|---|---|
| H1 | Context / major liquidity reference (not directly queried by v0.1's PDH/PDL/PWH/PWL, which use D1/W1 bars — H1 is reserved for future context filters) |
| M15 | Market structure / confirmed swing detection (feeds Equal High/Low and the M15-swing liquidity level) |
| M5 | Execution timeframe (sweep, displacement, MSS, FVG, retest all evaluated here) |

---

## 2. Project Layout & Portability Architecture

```
AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5   Main EA: MT5-specific orchestration + execution
Include/
  AT24_G01_Types.mqh          Plain data: enums, structs, the universal SBar bar type
  AT24_G01_Utils.mqh          PLATFORM ADAPTER — the only file calling CopyRates/CopyTime/
                               SymbolInfo*/iATR directly
  AT24_G01_Liquidity.mqh      PURE — PDH/PDL/PWH/PWL/EQH/EQL assembly
  AT24_G01_Swings.mqh         PURE — confirmed swing-high/low detection
  AT24_G01_Sweep.mqh          PURE — liquidity sweep detection
  AT24_G01_Displacement.mqh   PURE — displacement candle measurement
  AT24_G01_MSS.mqh            PURE — market structure shift detection
  AT24_G01_FVG.mqh            PURE — fair value gap detection + fill check
  AT24_G01_Risk.mqh           PURE — SL/TP/lot-size formulas
  AT24_G01_Filters.mqh        PURE — spread guard + session classification
  AT24_G01_Logging.mqh        Print + CSV telemetry (File I/O is near-identical on MT4/MT5)
  AT24_G01_StateMachine.mqh   PURE — state-transition/invalidation/daily-counter helpers
```

**Why this split exists:** every module marked *PURE* takes only plain data (`SBar`,
`SLiquidityLevel`, `double`, `datetime`, …) as parameters — it never calls an MT5-only
function itself. All MT5-specific calls (`CopyRates`, `CopyTime`, `SymbolInfoDouble`,
`iATR`/`CopyBuffer`, `PositionGetTicket`, `CTrade`, `AccountInfoDouble`) live in exactly two
places: `Utils.mqh` (the data-fetch adapter) and the main `.mq5` file's orchestration/
execution code. A future MT4 port of this *validated* strategy means rewriting those two
places (`iOpen/iHigh/iLow/iClose/iTime` instead of `CopyRates`, `MarketInfo()` instead of
`SymbolInfo*`, `OrderSend`/`OrderModify` instead of `CTrade`) — every strategy-rule file
above is unchanged, so the research rules themselves cannot drift between platforms.

---

## 3. Input Parameter Documentation

All inputs are grouped in the MT5 EA properties dialog (`input group "..."`). Defaults are
the baseline values; **do not optimize them for v0.1** — G01 is meant to be tested once,
frozen, and evaluated honestly.

| Input | Default | Meaning |
|---|---|---|
| `InpMagicNumber` | 24001 | Magic number. G01 only ever reads/writes positions matching `_Symbol` + this magic; it never touches another EA's trades. |
| `InpRiskPercent` | 0.5 | Risk per trade as % of account **equity** (not balance). Drives lot size via `G01_CalculateLotSize`. |
| `InpMaxTradesPerDay` | 2 | Max G01 entries per calendar day (broker/server date). Resets automatically at day rollover. |
| `InpTP_RMultiple` | 2.0 | Take-profit = `entry + R × this`, where `R = |entry − SL|`. No trailing, no partials, no breakeven in v0.1. |
| `InpSLBufferATRMultiple` | 0.25 | SL buffer beyond the sweep extreme, expressed as a multiple of ATR(14). Never a fixed dollar/point buffer. |
| `InpATRPeriod` | 14 | ATR period, calculated on M5. Feeds displacement sizing, sweep-penetration sizing, and the SL buffer. |
| `InpM15SwingLookback` | 3 | Bars required on **each side** to confirm an M15 swing (used for EQH/EQL and the Priority-4 M15 swing level). |
| `InpM5SwingLookback` | 3 | Bars required on **each side** to confirm an M5 swing (used as the MSS reference). |
| `InpEqualLevelATRTolerance` | 0.10 | Equal-High/Low clustering tolerance, as an ATR(14) multiple — never a fixed price distance. |
| `InpMinSweepPenetrationATR` | 0.05 | Minimum sweep penetration beyond the liquidity level, as an ATR(14) multiple. Not optimized in v0.1. |
| `InpDisplacementBodyATRMultiple` | 1.0 | Minimum displacement candle body size, as an ATR(14) multiple. |
| `InpDisplacementCloseLocationPct` | 0.70 | Minimum directional close-location-in-range ratio (close must sit in the outer 30% of the candle's range). |
| `InpSequenceTimeoutBars` | 24 | Max M5 bars an in-flight setup may remain unresolved (from sweep confirmation onward) before it is invalidated as stale. This is how "the liquidity reference becomes stale" is made deterministic — see [Invalidation](#8-invalidation-reasons). |
| `InpMaxSpreadPoints` | 500 | Maximum allowed spread in broker points at entry. **Broker-dependent — verify your XAUUSD point size before use**; this default is a placeholder, not a tuned value. |
| `InpMaxSlippagePoints` | 20 | Maximum execution deviation in broker points, passed to `CTrade::SetDeviationInPoints`. |
| `InpAllowedSession` | `SESSION_ALL` | Restricts entries to one named session; `SESSION_ALL` is the baseline testing mode (no restriction). The session of every trade is always logged regardless of this filter. |
| `InpAsiaStartHour`…`InpNYEndHour` | see file | Broker/server-time hour boundaries for Asia/London/Overlap/New York. **Must be re-tuned per broker's GMT offset** — the shipped defaults are a generic placeholder, not broker-verified. |
| `InpEnableNewsFilter` | false | Baseline OFF. Reserved for a future sprint's calendar-based filter — explicitly out of scope for v0.1's raw-strategy edge. |
| `InpEnableCSVLogging` | true | Writes one CSV row per closed trade (see [Logging](#9-research-logging-implementation)). |
| `InpCSVFileName` | `AT24_G01_ResearchLog.csv` | CSV file name, written via `FILE_COMMON` (Terminal's shared `Files` folder, survives per-run tester sandboxes). |

---

## 4. State Machine Explanation

```
STATE_IDLE
   │  (new M5 bar closes; a valid liquidity level exists; no G01 position open;
   │   daily trade limit not reached)
   ▼
STATE_LIQUIDITY_IDENTIFIED
   │  (same/later M5 bar close: DetectSweep matches the highest-priority level)
   ▼
STATE_SWEEP_CONFIRMED
   │  (later M5 bar close: CalculateDisplacement confirms in the sweep's direction)
   ▼
STATE_DISPLACEMENT_CONFIRMED
   │  (later M5 bar close: DetectMSS — a CLOSE beyond the most recent confirmed
   │   M5 swing in the sweep's direction)
   ▼
STATE_MSS_CONFIRMED
   │  (later M5 bar close: DetectFVG finds a 3-candle gap, same direction, formed
   │   at/after the MSS candle)
   ▼
STATE_FVG_CONFIRMED  →  STATE_WAITING_RETEST   (instant hand-off, same evaluation)
   │  (any tick: Bid/Ask reaches the FVG's 50% level, all entry gates pass)
   ▼
STATE_ENTRY  →  market order sent, case cleared  →  STATE_IDLE
```

`STATE_INVALIDATED` is not a resting state — it is entered and immediately reset to
`STATE_IDLE` in the same call (`G01_InvalidateCase`), after logging the reason. It exists
in the enum (per the spec's suggested state list) as a distinct, loggable event rather than
a place the EA lingers.

**Where each stage lives in code:**

| Stage | Function | File |
|---|---|---|
| Liquidity levels | `G01_AssembleLiquidityLevels` | `Liquidity.mqh` |
| Sweep | `G01_DetectSweep` | `Sweep.mqh` |
| Displacement | `G01_CalculateDisplacement` | `Displacement.mqh` |
| MSS | `G01_DetectMSS` | `MSS.mqh` |
| FVG | `G01_DetectFVG` | `FVG.mqh` |
| Entry level (50% FVG) | `G01_CalculateEntry` | `FVG.mqh` |
| SL / TP / lot size | `G01_CalculateSL` / `G01_CalculateTP` / `G01_CalculateLotSize` | `Risk.mqh` |
| Orchestration (the "ManageState" role) | `G01_ProcessNewM5Bar` (bar-close stages) + `G01_CheckRetestAndEnter` (tick-level retest/entry) | main `.mq5` |

The spec's suggested function name `ManageState()` is implemented as two functions rather
than one, because the retest→entry transition is inherently tick-driven (price touching a
level) while every earlier stage is bar-close-driven — splitting them keeps each one's
non-repainting contract explicit and easy to audit.

### Entry Execution Design

The FVG midpoint is monitored on every tick once `STATE_WAITING_RETEST` is reached; the
market order fires the instant Bid (bullish) or Ask (bearish) reaches the level. A resting
pending limit order at the FVG midpoint was considered as an alternative and rejected for
v0.1: a limit order gives an exact fill price but defers the spread/session/daily-limit
gating checks to an unpredictable future tick, which muddies the "SPREAD_BLOCK ⇒ NO ENTRY"
rule the spec states plainly. Tick-monitoring keeps the gating checks and the entry trigger
atomic and simple to audit, at the cost of a small amount of `InpMaxSlippagePoints`-bounded
execution slippage versus a theoretical perfect fill. This is a deliberate, documented
simplification, not a hidden discretionary choice.

---

## 5. Non-Repainting Explanation

Every signal-bearing calculation in this EA reads **only bars that have already closed**:

- `G01_FetchBar` / `G01_FetchBarWindow` in `Utils.mqh` clamp `shift` to a minimum of `1`
  structurally — shift `0` (the currently-forming bar) can never be requested by any caller,
  even by mistake, because the adapter itself refuses it.
- PDH/PDL and PWH/PWL come from `CopyRates(..., PERIOD_D1/W1, shift=1, count=1, ...)` — the
  previous **completed** daily/weekly bar, never the one currently forming.
- Confirmed swings (`G01_EvaluateSwingWindow`) only ever evaluate the bar sitting at the
  centre of a `(2×lookback+1)`-bar window of already-closed bars, i.e. a candidate bar is
  examined for the first time only once `lookback` newer closed bars exist to its right.
  Once evaluated, a bar is never re-examined (the sliding window moves past it), so a swing
  confirmation, once logged, never changes retroactively.
- MSS compares a closed candle's **close** (never its high/low wick) against the most
  recent confirmed swing — wick breaks are explicitly rejected (`DetectMSS`'s `<=`/`>=`
  guard).
- FVG only forms from three already-closed candles (`candle1`, `candle2` implicit gap,
  `candle3`), gated additionally to have formed at/after the MSS candle's time.
- The only value read on a live, still-forming basis is Bid/Ask during
  `STATE_WAITING_RETEST`, and that is inherent to what "wait for retracement" means — it is
  a live price-touch trigger, not a recalculated indicator value, so it cannot repaint a
  past decision.

No function in this project uses `CopyRates`/`CopyBuffer` with a negative or zero shift, and
no historical state (sweep/displacement/MSS/FVG event, or `g_case`) is ever overwritten by
later information — invalidation always produces a **new**, separately logged event
(`INVALID_*` reason) rather than silently rewriting the old one.

---

## 6. Full Configurable Parameter List

See [§3](#3-input-parameter-documentation) for the complete table with descriptions. Nothing
in the strategy logic is hard-coded that the spec required to be configurable: equal-level
tolerance, sweep-penetration threshold, displacement thresholds, SL buffer, TP multiple,
swing lookbacks, sequence timeout, max spread, max slippage, session hours, risk %, and max
trades/day are all `input` parameters.

---

## 7. Entry Decision Explanation

A trade is only ever opened when **all** of the following are true simultaneously:

1. The full sequence (liquidity → sweep → displacement → MSS → FVG) completed in strict
   order on closed M5 candles, all in the same direction.
2. Live price (Bid for buys, Ask for sells) has reached the FVG's 50% retracement level —
   the sole entry trigger; no RSI/EMA/MACD/volume/candle-pattern/AI confirmation is used,
   per the spec.
3. No G01 position is currently open (`G01_HasOpenPosition`).
4. The daily trade counter (`g_dailyTradeCount`) is below `InpMaxTradesPerDay`.
5. Current spread ≤ `InpMaxSpreadPoints`.
6. The news filter, if enabled, does not block (baseline: always OFF, always passes).
7. The current session is allowed by `InpAllowedSession` (`SESSION_ALL` always passes).

SL is placed below the sweep low (buy) / above the sweep high (sell), plus an
ATR-relative buffer. TP is a fixed `InpTP_RMultiple × R` from entry. Lot size is derived
from `InpRiskPercent` of current equity, the symbol's live tick value/size, and clamped to
the broker's min/max/step lot constraints — never a hard-coded lot size.

---

## 8. Invalidation Reasons

| Reason | Logged as | Trigger |
|---|---|---|
| Sequence stalled too long | `SEQUENCE_TIMEOUT` | More than `InpSequenceTimeoutBars` M5 bars elapsed since the sweep was confirmed without reaching entry. |
| Opposite-direction sweep | `OPPOSING_SWEEP` | A new sweep in the opposite direction is detected against any valid liquidity level while a case is in flight (checked at `SWEEP_CONFIRMED` and `DISPLACEMENT_CONFIRMED`). |
| Opposite-direction MSS | `OPPOSING_MSS` | A closed M5 candle closes beyond the *opposite* confirmed swing while waiting for MSS confirmation — structure shifted against the setup. |
| FVG fully mitigated | `FVG_INVALIDATED_BY_CLOSE` | A closed candle's close passes all the way through the FVG's far boundary before retracement reached 50% — the gap was consumed and price continued against the setup. |
| Spread too wide at entry | `SPREAD_BLOCK` | Current spread exceeds `InpMaxSpreadPoints` at the exact tick price reaches the entry level. |
| Session not allowed | `SESSION_BLOCK` | `InpAllowedSession` is set to a specific session and the entry tick falls outside it (or the news filter, if enabled, blocks). |
| Daily limit reached | `DAILY_LIMIT_REACHED` | `InpMaxTradesPerDay` already hit — checked both when a new setup would start forming and again at the entry tick. |
| Position already open | `MAX_POSITIONS_OPEN` | A G01 position (same symbol + magic) is already open — checked when a new setup would start forming and again at the entry tick, enforcing "max one open G01 position." |
| Liquidity reference lost | `LIQUIDITY_STALE` | While in `STATE_LIQUIDITY_IDENTIFIED`, a fresh rebuild of the liquidity level list comes back empty (e.g. no PDH/PDL/PWH/PWL/EQH/EQL/M15-swing currently valid). |

Every invalidation is logged via `G01_LogInvalidation` (`[G01][INVALIDATED] reason=... context=...`)
before the case is cleared and the state resets to `STATE_IDLE`. No invalidation rule is
discretionary — each is a fixed, documented condition, not a judgment call made at runtime.

---

## 9. Research Logging Implementation

**Print/structured log** (`G01_LogEvent`, always on): every state transition, every detected
sweep/displacement/MSS/FVG, every entry attempt, and every invalidation is printed with the
`[G01][TAG]` prefix, e.g.:

```
[G01][SWEEP] type=PDL level=2415.30000 dir=BULLISH pen_atr=0.18
[G01][DISPLACEMENT] dir=BULLISH body_atr=1.42 close_loc=0.83
[G01][MSS] dir=BULLISH broken=2417.90000 close=2418.15000
[G01][FVG] dir=BULLISH upper=2417.10000 lower=2416.40000 size_atr=0.31
[G01][ENTRY] dir=BULLISH entry=2416.75000 sl=2414.80000 tp=2420.65000 lots=0.05 session=LONDON sent=true
[G01][CLOSE] ticket=... result=WIN profit=42.10 R=2.00 reason=TP
```

**CSV research log** (`InpEnableCSVLogging`, default on): one row per **closed** trade,
written to the Terminal's shared `Files` folder via `FILE_COMMON` (so it survives per-agent
Strategy Tester sandboxes and is easy to locate after a run). The row is deferred from entry
time to close time (`OnTradeTransaction`, filtering on `DEAL_ENTRY_OUT` + this EA's magic +
symbol) so it can carry the trade's real outcome:

```
timestamp,symbol,liquidity_type,liquidity_price,sweep_direction,sweep_penetration,atr,
displacement_ratio,mss_price,fvg_high,fvg_low,fvg_size,entry,sl,tp,risk,session,spread,
result,R_multiple,exit_reason
```

- `result` is `WIN`/`LOSS` from the realized deal profit (incl. swap/commission).
- `R_multiple` = `(close_price − entry) / (entry − SL)`, sign-correct for both directions —
  the standard price-distance definition, independent of money P/L rounding.
- `exit_reason` is read directly from MT5's `DEAL_REASON` (`SL`, `TP`, `MANUAL`, `EXPERT`,
  `STOPOUT`), not inferred.

---

## 10. MT5 Strategy Tester Instructions

1. Copy the whole `G01_LiquiditySweep_MSS_FVG` folder's contents into your terminal's data
   folder: `.mq5` → `MQL5\Experts\`, and the `Include\AT24_G01_*.mqh` files → `MQL5\Experts\Include\`
   (or keep the relative `Include\` folder alongside the `.mq5` — either layout compiles,
   since the includes use a relative quoted path). Recompile inside MetaEditor if you moved
   the files (F7), or use the pre-built `.ex5` directly.
2. Open **Strategy Tester** (View → Strategy Tester, or Ctrl+R).
3. **Expert Advisor**: `AT24_GOLD_G01_LiquiditySweep_MSS_FVG`.
4. **Symbol**: your broker's XAUUSD symbol (or gold variant — the EA reads symbol
   properties dynamically, so it is not hard-coded to one broker's digits/contract size).
5. **Period**: any (the EA fetches H1/M15/M5/D1/W1 explicitly regardless of chart period;
   M5 or M1 is recommended so the tester feeds ticks frequently enough for responsive
   retest detection).
6. **Model**: **Every tick based on real ticks** — required for the frozen baseline
   statistics; do not use "Open prices only" or a synthetic-tick model for final numbers.
7. **Date range**: pick a period with real-tick history available for your broker/symbol.
8. **Inputs**: leave at defaults for the true v0.1 baseline run. Before trusting spread
   and session results, verify `InpMaxSpreadPoints` and the session-hour inputs against
   your broker's actual XAUUSD point size and server GMT offset (both are explicitly
   flagged as broker-dependent placeholders in §3).
9. Run. After completion, check the **Journal**/**Experts** tab for the `[G01][...]` log
   stream, and locate `AT24_G01_ResearchLog.csv` in the terminal's shared `Files\` folder
   (`MQL5\Files\` at the Common Data Path level — `File → Open Data Folder` → go up one to
   the Common folder, or check `Terminal → Common\Files` under `%APPDATA%\MetaQuotes\Terminal\Common\Files`)
   for the row-per-trade research dataset.
10. Do **not** run the built-in Optimizer against this baseline — v0.1 is explicitly a
    frozen, non-optimized reference run. See below for how later experiments should branch.

---

## Control Experiments & Future Forks

The spec calls for two future variants — **G01-B** (Sweep + MSS, FVG disabled) and
**G01-C** (MSS + FVG, sweep disabled) — as **separate, standalone EAs**, explicitly not as
runtime toggles combined into this one file. This project intentionally does **not** ship
an `InpEnableSweep`/`InpEnableFVG`-style switch, because that would combine three research
experiments into one optimizable strategy, which the spec forbids.

To create a control-experiment build later:

1. Copy this entire folder to a sibling folder (e.g. `G01-B_MSS_FVG_NoSweep/`).
2. In the copy's `.mq5`, bypass the relevant stage in `G01_ProcessNewM5Bar`:
   - **G01-B** (no FVG gating): skip the `STATE_MSS_CONFIRMED` → FVG search and transition
     straight to `STATE_WAITING_RETEST` using the MSS candle's close as the entry reference
     instead of an FVG midpoint (requires a small, explicit `CalculateEntry` substitute —
     do not silently reuse the FVG code path with dummy values).
   - **G01-C** (no sweep gating): skip `STATE_IDLE`'s `DetectSweep` requirement and enter
     `STATE_SWEEP_CONFIRMED` directly once a liquidity level is merely present, using the
     liquidity level itself (not a sweep event) as the SL reference.
3. Give the fork its own `InpMagicNumber` and its own frozen version tag. Because every
   detection stage lives in its own pure, parameter-driven module (`Sweep.mqh`,
   `Displacement.mqh`, `MSS.mqh`, `FVG.mqh`), the fork only ever touches the orchestration
   function in the `.mq5` — none of the underlying math changes.

Each variant is compiled, tested, and evaluated as its own independent research artifact —
never optimized against the others, never merged back into one "best of" EA.
