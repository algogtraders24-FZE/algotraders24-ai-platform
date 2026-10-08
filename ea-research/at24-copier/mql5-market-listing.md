# AT24 Local Trade Copier - MQL5 Market listing (ready to paste)

Status: **text only**. Two things must exist before it can be submitted (see "Before you submit").

## Product name (max ~63 chars)
AT24 Local Trade Copier MT5

## Short description (the one-line summary under the title)
Copies open trades between MT4 and MT5 accounts on the same PC or VPS - no server, no DLL, no internet.

## Full description (paste as plain text)

AT24 Local Trade Copier mirrors the open positions of one MetaTrader account onto another MetaTrader account running on the same computer or VPS - MT4 to MT5, MT5 to MT4, MT5 to MT5 and MT4 to MT4.

HOW IT WORKS
A Master instance reads the open positions of the source account and publishes them as a small text file in the terminals' shared Common folder. A Receiver instance on the destination account reads that file and mirrors the trades. Nothing goes through a server: no DLL, no web requests, no account passwords, nothing is sent to anyone. The source account only needs to be logged in; the Master never sends an order.

WHAT IS COPIED
- New market positions (symbol, direction, volume scaled to your settings)
- Stop loss and take profit, including every later change
- Partial closes and added volume
- Closes

KEY FEATURES
- Lot sizing: multiplier, fixed lot or equity ratio, with a hard cap per trade
- Reverse copy (buys become sells, SL and TP are swapped)
- Symbol mapping: strip the source broker's prefix/suffix, add yours, or map names explicitly (XAUUSD=GOLD)
- Filters: allowed symbols, source magic number, maximum spread, maximum slippage
- DryRun mode: shows what it WOULD do without sending any order
- Works across MT4 and MT5, and across different brokers

BUILT-IN SAFETY
- A silent or offline Master never makes the Receiver do anything
- Partially written files are rejected (CRC-32 checksum)
- Trades already open when the Receiver starts are NOT copied unless you choose so
- Copies are closed on an empty source book only after a confirmation delay
- At most 3 open attempts per trade; an order with unknown outcome is never blindly re-sent
- Only one Receiver per channel and terminal can act (prevents double copies)
- Every copy carries its own magic number and tag - your manual trades and other EAs are never touched

SETUP (3 minutes)
1. Attach the Master to a chart of the source account and set a ChannelId (e.g. "gold1").
2. Attach the Receiver to a chart of the destination account with the SAME ChannelId.
3. Enable algo trading on the Receiver. Start on demo accounts and use DryRun first.
Both terminals must run under the same Windows user (they share the Common\Files folder).

REQUIREMENTS
- MT5 destination accounts must be hedging accounts. MT4 destinations need a broker that allows hedging and has no FIFO rule.
- Same computer or VPS only. Pending orders are not copied (filled positions only).
- Not usable in the Strategy Tester.

TESTING (real demo accounts)
Every master action was verified on the receiving account: open at the scaled volume with SL/TP, SL/TP change, partial close, a second position, closing one position, final close - and a pre-existing position on the receiving account stayed untouched. Tested MT5 to MT5 across two brokers, MT5 to MT4 and MT4 to MT5 across two brokers, and MT4 to MT4 in a single terminal. Typical mirroring time on the test machine was about 0.2-1 second. Not tested: netting destination accounts, live-money accounts, brokers that forbid hedging or copying.

IMPORTANT
This tool contains no trading strategy and makes no profit claim. Trading leveraged products is risky. Check that your broker allows trade copying and hedging. Copying accounts you do not own or manage, or selling signals, may require a licence in your country - you are responsible for compliance.

Website: https://www.algotraders24.ai

## Tags / category
Category: Utilities. Keywords: trade copier, copy trading, local copier, MT4 to MT5, MT5 to MT4, mirror trades, symbol mapping, lot multiplier.

## Screenshots to upload (take from the demo test, 1280x720 or similar)
1. Master chart comment ("publishing 2 position(s)") next to Receiver chart comment ("running, Opened 1 ...").
2. The two terminals side by side with the same position (source and copy).
3. Receiver inputs dialog (Lot sizing + Symbols groups).
4. Experts log with "copied master #... -> BUY 0.05 ..." lines.
Use the generated icons in `ea-research/marketplace-research/m16-copier/branding/` for the product logo (MQL5 wants 200x200: export the SVG at that size).

## Price
Suggested: same as the AT24 marketplace ($79) or lower for the first reviews; FX Blue's local copier is free, so the value argument is MT4<->MT5 + safety + support.

## Before you submit (honest blockers)
1. **One file per product.** MQL5 Market delivers a single compiled file. Our package has two EAs (Master + Receiver). A single-file build with a `Mode` input (Master / Receiver) must be made first - small change, but it needs its own re-test. (MT4 variants sell on the MT4 side of the Market as separate .ex4 products.)
2. **Market validation runs the product in the Strategy Tester.** The EAs currently refuse to start in the tester (`INIT_FAILED`) on purpose. For the Market the tester run must end without errors, so the single-file build needs an "idle in tester" mode instead of failing.
3. The submission itself (seller account, upload, screenshots, price) has to be done by you on mql5.com - I do not log in to or submit to third-party sites.
