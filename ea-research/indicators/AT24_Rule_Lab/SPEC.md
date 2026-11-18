# AT24 Rule Lab - specification (v1.00, MT5, H1)

Honest purpose: six popular adaptive / momentum indicators (KAMA, FRAMA, HMA, TSI, Vortex, Squeeze) turned into plain rules, measured on the chart symbol's own history inside each of the 5 AT24 Regime AI market states (average result, number of trades, luck test, optional protective stop), with what happened after similar situations (AT24 Analog Finder) shown underneath. A measurement of the past, not a forecast. Places no trades.

## 1. R&D result that decided the design (2026-11-18)
Out of sample (last 40 % of the H1 history of 13 symbols), entry next open, hold 24 bars, protective stop 2 ATR, spread cost, one trade per rule per 24 bars, result in ATR(14) units (`test/rnd_rule_lab.py`, `rnd_rule_lab_result.json`). Pooled average per rule and state (symbols with a positive average of those with 30+ trades in brackets):

| Rule | NOISY | WIDE SWING | STRONG MOVE | COMPRESSED | STEADY TREND |
|---|---|---|---|---|---|
| KAMA | -0.156 (5/13) | -0.059 (4/12) | -0.330 (1/11) | -0.075 (5/12) | -0.032 (6/13) |
| FRAMA | -0.188 (2/13) | -0.043 (4/12) | -0.270 (3/11) | -0.038 (6/12) | -0.023 (5/13) |
| HMA | -0.099 (3/13) | -0.050 (5/12) | **+0.082 (8/12)** | -0.058 (7/13) | -0.069 (3/13) |
| TSI | -0.127 (4/13) | +0.020 (6/12) | -0.343 (1/11) | -0.116 (4/12) | +0.004 (6/13) |
| VORTEX | -0.157 (4/13) | +0.027 (7/12) | -0.209 (3/11) | -0.065 (5/12) | -0.073 (5/13) |
| SQUEEZE | -0.073 (5/13) | -0.255 (2/10) | -0.585 (0/1) | **+0.045 (7/13)** | +0.015 (6/12) |

Reading: most cells are negative after costs; every rule is worst in NOISY markets; the two clearest positive cells are HMA in STRONG MOVE (+0.08) and SQUEEZE in COMPRESSED (+0.045, the release of a squeeze after a compression, consistent with the AT24 Strategy Fit finding). Nothing here is a strong edge; the value is knowing in which state each popular indicator has historically been used badly or well on the chart symbol.

## 2. The six rules (closed bar i, chronological arrays, only bars <= i; signals from bar index 250)
TR_i = max(H - L, |H - C_{i-1}|, |L - C_{i-1}|), TR_0 = H_0 - L_0. Result +1 long, -1 short, 0 none.
1. **KAMA**: er = |C_i - C_{i-10}| / sum_{j=i-9..i} |C_j - C_{j-1}| (0 when the sum is 0 or i < 10); sc = (er x (2/3 - 2/31) + 2/31)^2; KAMA_0 = C_0, KAMA_i = KAMA_{i-1} + sc (C_i - KAMA_{i-1}). Long if C_i > KAMA_i and KAMA_i > KAMA_{i-1}; short for the mirror.
2. **FRAMA (16)**: for i < 16 FRAMA_i = C_i; otherwise N1 = (max H - min L over bars i-7..i) / 8, N2 = same over i-15..i-8, divided by 8, N3 = same over i-15..i divided by 16; if all three are above 0: D = (ln(N1 + N2) - ln N3) / ln 2, alpha = clamp(exp(-4.6 (D - 1)), 0.01, 1), else alpha = 0.5; FRAMA_i = alpha C_i + (1 - alpha) FRAMA_{i-1}; FRAMA_0 = C_0. Long if C > FRAMA and FRAMA rising; short mirror.
3. **HMA (21)**: WMA weights 1..n (the newest bar has weight n). raw_i = 2 WMA(C, 10)_i - WMA(C, 21)_i; HMA_i = WMA(raw, 4)_i (4 = floor(sqrt 21)). Long if C > HMA and HMA rising; short mirror.
4. **TSI (25, 13, signal 7)**: m_i = C_i - C_{i-1} (i >= 1); EMA with alpha = 2 / (span + 1) seeded on the first value (i = 1). e1 = EMA13(EMA25(m)), e2 = EMA13(EMA25(|m|)), TSI = 100 e1 / (e2 + 1e-12), signal = EMA7(TSI). Long if TSI > signal, short if TSI < signal.
5. **Vortex (14)**: VI+ = sum_{14} |H_i - L_{i-1}| / sum_{14} TR_i, VI- = sum_{14} |L_i - H_{i-1}| / sum_{14} TR_i over bars i-13..i. Long if VI+ - VI- > 1e-12, short if VI+ - VI- < -1e-12 (a floating-point tie is no signal; the sums of 14 terms can be equal in exact arithmetic when the bars overlap, and the sign would then depend on the summation order).
6. **Squeeze (20)**: basis = SMA20(C), dev = 2 x population std20(C), ATR20 = SMA20(TR); squeeze on if dev < 1.5 ATR20 (the Bollinger band is inside the Keltner channel; both band conditions reduce to this one). mid = ((max H20 + min L20) / 2 + basis) / 2, mom = C - mid. A signal only on the bar where the squeeze switches off (on at i-1, off at i): long if mom > 0, short if mom < 0.

## 3. Trades and statistics
Identical to AT24 Strategy Fit (SPEC 3, 5a): signal at i, entry next open, hold 24 bars, optional protective stop (input, default 2.0 ATR of the signal bar, checked on the high / low of the 24 bars from the entry bar), cost = current spread, R = result / ATR14_i; per rule at least 24 bars between taken trades; the trade belongs to the market state (AT24 Regime AI) of its signal bar; cells = rule x state; average, hit rate, luck test (3000 xorshift32 sign flips), classes FIT / NEUTRAL / AVOID / too few (n < 30).

## 4. Analog block (AT24 Analog Finder, SPEC of AT24_Analog_Finder)
The panel repeats the 30 analogs of the last closed bar (median and 80 % band in ATR and price, share up) and the self-test verdict ("direction NOT RELIABLE here" unless the symbol's own self-test passes).

## 5. Output
Dashboard (default off in the Strategy Tester): current market state, the six rules with their signal on the last closed bar and their own record in the current state, the 6 x 5 grid of averages with n and class, the analog block. Optional arrow and alert when a rule signals in a state where its record is FIT. Buffers 0-5: signals of the six rules; 6-11: class of each rule in the current state (1 FIT, 0 neutral or no claim, -1 AVOID).

## 6. Limits written on the product
Averages are measurements of past bars; cells with few trades prove nothing (n shown); with 30 cells some FIT cells appear by chance. The measured trade includes the stop shown on the panel. Past results do not predict future results. Not financial advice.
