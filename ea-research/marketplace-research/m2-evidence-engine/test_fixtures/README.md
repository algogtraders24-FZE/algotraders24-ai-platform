# Test fixtures — SYNTHETIC, NOT REAL BACKTEST DATA

Every file in this directory is fabricated data used only to prove
`evidence_engine.py`'s parsing/integrity/metrics code is correct. None of it
represents G01, Gold Auto Strategy, or any real trading result.

- `sample_report.htm` — a minimal hand-built HTML file shaped like an MT5
  native Strategy Tester report table, with made-up settings values.
- `sample_tradelog.csv` — 6 fabricated trade rows in the
  `AT24_G01_ResearchLog.csv` column format, with round, obviously-synthetic
  numbers (entry prices like 2000.00, 2010.00, ...).
- `bad_tradelog.csv` — deliberately broken (duplicate row + a negative
  price) to prove the Data Integrity stage actually halts the pipeline.

Do not copy numbers out of this directory into any report, listing, or
conversation as if they were real G01 performance.
