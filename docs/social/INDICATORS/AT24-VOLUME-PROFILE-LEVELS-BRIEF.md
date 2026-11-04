# AT24 Volume Profile Levels - marketing brief (new indicator)

**Name:** AT24 Volume Profile Levels  **Tagline:** Yesterday's busiest price and value area - and what price really did there.
**Platforms:** MT5 only for now (H1 or lower chart). **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Volume_Profile_Levels/branding/` (logo, screenshot_mt5.png).

## What it solves
Point of control (POC) and value area levels are popular, but most tools only draw them. The indicator builds yesterday's volume profile from tick volume (CFD/FX have no exchange volume), draws POC / VAH / VAL and the shaded value area across today, says whether price is inside, above or below, and measures on YOUR symbol how often price touched these levels and whether it reacted, against mirrored control levels at the same distance.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (87 days): yesterday's POC/VAH/VAL were touched 67-69 % of days (mirrored control levels 56-63 %); reaction rates (44-64 %) were not different from the controls.
- Profiles and statistics verified against an independent Python calculation (all 88 daily profiles and all three studies identical). No repaint: closed bars only.
- Honest about its data: tick volume from the broker feed.

## Claims you must NOT make
- No "POC is support/resistance", "value area reversion" or any edge/win rate: the reaction statistics are within noise.
- Not exchange volume; other brokers' tick volumes give different profiles. 87 days is a small sample.

## Footer text
"Descriptive history on your broker's data (tick volume). Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
