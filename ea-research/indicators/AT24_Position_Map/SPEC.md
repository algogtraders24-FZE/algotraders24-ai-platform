# AT24 Position Map - exact rules (v1 spec, written before any code)

Every rule works on CLOSED bars only (nothing repaints). Prices are bar highs, lows and closes. A "swing" is only used once it is confirmed.

## 1. Swings (per timeframe)

- **Swing high** at bar i: high[i] is strictly greater than the highs of the k bars before it AND of the k bars after it. A swing high is confirmed when bar i+k has closed (so it is known k bars late, never earlier).
- **Swing low**: mirror (low strictly below the lows of the k bars on each side).
- **k per timeframe**: W1 = 2, D1 = 3, H4 = 3 (inputs).
- **Minimum size**: a swing counts only if it sits at least `MinSwingAtr` (default 0.75) times ATR(14) of that timeframe away from the previous opposite swing. Smaller swings are ignored (noise).
- **Alternation**: swings must alternate high, low, high, low. If two highs come in a row, keep the higher one and drop the other; if two lows come in a row, keep the lower one.
- Equal highs or lows are not swings (strict inequality), so a flat top is not counted twice.

## 2. Trend (Dow structure), per timeframe, from the last confirmed swings

- **UP**: the last two swing highs rise (HH) AND the last two swing lows rise (HL).
- **DOWN**: the last two swing highs fall (LH) AND the last two swing lows fall (LL).
- Anything else = **RANGE** (not a trend, no entries).
- **Structure break (trend ends)**: in an UP trend, a bar that CLOSES below the last swing low (the HL) ends the trend; in a DOWN trend, a bar that CLOSES above the last swing high (the LH) ends it. After a break the state is RANGE until new swings confirm a new HH/HL or LH/LL pattern. A wick through the level without a close does not count.
- **Continuation**: in an UP trend a close above the last swing high is a break of structure upward (new leg); the next pullback low will become the next HL.

## 3. Direction (the only source of entries)

**Direction = the W1 trend.** UP means only longs, DOWN means only shorts, RANGE means no trade. D1 is shown for information only: a D1 move against the W1 trend is the pullback we want to buy or sell, so it must not block the setup.

## 4. Zone (where a pullback is allowed to be bought or sold)

Long, W1 trend UP, with the last W1 swing low L (the HL) and the last W1 swing high H:
- The structure must be intact: no W1 close below L.
- Price must be inside the **pullback zone**: between L and H, and retraced at least `MinRetrace` (default 38.2 %) of the leg from L up to H, measured with the current price: (H - price) / (H - L) >= MinRetrace.
- A support level inside the zone (a D1 or W1 swing low, or L itself) is shown; the stop uses the pullback low (section 5).
- Short: mirror (W1 trend DOWN, between H (the LH) and L, retraced at least MinRetrace upward).

## 5. H4 trigger (entry)

Long, after price is inside the pullback zone:
1. Let **P** be the lowest low since price last made the swing high H (the pullback low), and **B** the most recent confirmed H4 swing high after H (the lower high inside the pullback).
2. **Trigger**: a confirmed H4 swing low appears that is HIGHER than the previous H4 swing low (an H4 higher low), AND a H4 bar then CLOSES above B (an H4 break of structure upward). The bar that closes above B is the trigger bar.
3. **Entry**: the open of the next H4 bar after the trigger bar.
4. **Stop**: below P by `StopBufferAtr` (default 0.25) times ATR(14) of H4. The stop is always structural (the pullback low plus a small buffer), never a fixed distance.
5. **Target**: the measured move: the last W1 leg (from the W1 swing low before H up to H) repeated from the pullback low: TP = P + (H - Lleg) for a long, TP = P - (Hleg - L) for a short (AB = CD). **Minimum reward to risk** `MinRR` (default 2.0): if (TP - entry) / (entry - stop) < MinRR the setup is shown as "rejected: reward too small"; if the measured move is already behind the entry it is "rejected: no room". The nearest weekly and daily resistance (support for a short) is shown as information only, it is not the target.
   *Change after the first run (2026-11-17): the first version of this rule took the nearest W1/D1 swing beyond the entry as the target. On 5 years of XAUUSD it produced 129 triggers of which 117 had a reward below 2R, with a median of 0.14R, because minor daily swings sit right next to the entry. That made almost every setup unusable, so the target was changed to the measured move, a standard price-action projection. This was decided from the rule's geometry, not from trade profits.*
6. **Invalid before trigger**: P is the running lowest low of the pullback, so a new lower low only deepens the pullback (P moves down and a new H4 higher low is needed). The setup ends only when the W1 structure breaks: a W1 close below the newest W1 swing low ends the trend (section 2) and with it every long setup.
7. **Time stop** (plan only): `TimeStopWeeks` (default 8). If the target and the stop are both untouched after that many weeks the plan expires.
- Short: all of the above mirrored.

One setup at a time per symbol and side; a new trigger cannot appear while a plan is open.

## 6. Plan outputs (not orders)

Entry, stop, target, reward to risk, risk in ATR(W1), lot size from `RiskPercent` of the balance and the symbol tick value, holding cost per week from the symbol swap (triple-swap day counted), spread. The indicator never sends orders.

## 7. Scorecard (honest record)

Every setup the rules would have produced in the loaded history is walked forward on the real bars: entry at the next H4 open, stop and target as above, both inside one bar counts as the stop, timed exit at TimeStopWeeks at the close, cost = spread plus swap. Result in R after cost. The dashboard shows: count, hit rate, average R, a sign-flip luck test p-value (like Setup Pro), and the same numbers for a random-direction control. Under 30 setups the verdict is "too few"; |t| of 2.58 or more is "positive/negative on this history", otherwise "no edge shown".

## 8. Trend life statistics (per symbol, from W1 history)

Completed W1 legs (swing to swing) in the loaded history: median trend duration in weeks, median pullback depth in W1 ATR and as percent of the leg, the share of pullbacks deeper than MinRetrace and deeper than 61.8 %, and how often a pullback ended in a structure break (trend ended).

## 9. Fixed defaults (inputs)

`SwingBarsW1 2, SwingBarsD1 3, SwingBarsH4 3, MinSwingAtr 0.75, MinRetrace 0.382, StopBufferAtr 0.25, MinRR 2.0, TimeStopWeeks 8, RiskPercent 0.5, history 520 W1 bars`.

## 10. Known limits (stated up front)

Swings are known k bars late. A trend defined by two swings flips quickly in choppy markets (that is why RANGE gives no trade). The scorecard is in-sample on one broker feed; the rules have several parameters, so tuning them until the scorecard passes finds a lucky set. Our earlier tests (pullbacks, zones, structure labels) found no edge, so the scorecard may well say "no edge shown"; that is an acceptable and honest outcome.
