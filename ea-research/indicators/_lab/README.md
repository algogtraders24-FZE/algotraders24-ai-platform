# AT24 Research Lab

Our own, pre-registered research on XAUUSD (and later other symbols). Rules of the lab:
1. Hypotheses, data window, splits and the decision rule are written in the script header BEFORE results are looked at.
2. Nulls respect the data (shuffle within day, circular shift, permutation of labels), never plain t-tests on overlapping data.
3. Multiple-testing correction across the hypotheses of a lab (Bonferroni), and an untouched holdout / final period.
4. A result is a FINDING only if it survives all of the above. Everything else is reported as "no finding", including what failed in the holdout.
5. Raw data are NOT committed (`data/` is git-ignored); regenerate them with `mt5/AT24_LabExport.mq5` in a terminal that has the history.

Files: `py/lab01_preregistered.py`, `py/lab02_original.py`, `reports/*.json` (machine results), `reports/LAB-01-02-REPORT.md` (the write-up).
Run: `cd py && python lab01_preregistered.py ../data` (numpy, pandas, scipy).

Lab 03 data: the export is kept outside the repository (E:/at24_lab_data); `python lab03_sessions_and_exits.py <data dir>` reproduces reports/lab03_results.json.

- Lab 04 (2026-11-10): `py/lab04_tradability_and_gaps.py`, `reports/LAB-04-REPORT.md` - cost by hour (stable ranking; spread is flat, range drives it) and daily-break gap after news (no effect).
- Lab 05 (2026-11-11): `py/lab05_coiled_spring_and_levels.py`, `reports/LAB-05-REPORT.md` - compression breakouts, round numbers, quiet-London coiled spring (all no finding; the coiled-spring belief has the wrong sign).
- Lab 06 (2026-11-11): `py/lab06_calendar_and_surprises.py`, `reports/LAB-06-REPORT.md` - turn of the month, hawkish-surprise reaction (candidate, fails train), weekend gap (train not testable).
- Lab C1 (2026-11-11): `py/lab_c1_crypto_funding_weekend.py`, `reports/LAB-C1-CRYPTO-REPORT.md` - BTC/ETH funding extremes and weekend effect (no finding; funding carry collapsed to ~3.5 %/yr). Strategy memo: `docs/CRYPTO-RD-2026-11-11.md`.
- Lab C2 (2026-11-11): `py/lab_c2_btc_price_structure.py`, `reports/LAB-C2-BTC-STRUCTURE-REPORT.md` - stable BTC intraday/weekend/funding-hour structure (descriptive); memo `docs/CRYPTO-INDICATOR-RD-2026-11-11.md`.
