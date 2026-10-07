AT24 LOCAL TRADE COPIER  -  MT4 to MT5  -  v1.0.0
=================================================================
Copies the open positions of one MetaTrader 4 account to another
MetaTrader 5 account on the SAME computer (or the same VPS).
No server, no DLL, no internet connection and no account password is
used: the two terminals exchange a small text file in the shared
"Common\Files" folder (MT4 and MT5 both use it, so both terminals must run
under the same Windows user).

WHAT YOU GET
  AT24_Copier_Master_MT4.ex4      - attach in the MT4 terminal you want to COPY FROM
  AT24_Copier_Receiver_MT5.ex5    - attach in the MT5 terminal you want to COPY TO

SET UP (about 3 minutes)
 1. Copy AT24_Copier_Master_MT4.ex4 into the MQL4\Experts folder of the SOURCE terminal and
    AT24_Copier_Receiver_MT5.ex5 into the MQL5\Experts folder of the DESTINATION terminal
    (File > Open Data Folder > MQL4/MQL5 > Experts), restart or refresh.
 2. SOURCE terminal: drag "AT24_Copier_Master_MT4" onto any chart.
    Set ChannelId (e.g. "gold1"). The Master only READS positions - it never
    sends an order.
 3. DESTINATION terminal: drag "AT24_Copier_Receiver_MT5" onto any chart.
    Set the SAME ChannelId. Allow trading: the AutoTrading / Algo Trading
    toolbar button and "Allow live trading" / "Allow Algo Trading" in the EA
    properties.
 4. The chart comment shows the live status: master found / offline, copies
    opened, closed, SL/TP updates, skipped, errors.
 5. START ON A DEMO ACCOUNT FIRST and use the Receiver's DryRun option to see
    what it would do before it sends any order.
 Only ONE Receiver may run per channel in a terminal: a second one detects the
 first and does nothing (otherwise every trade would be copied twice).

THE DESTINATION ACCOUNT MUST BE A HEDGING ACCOUNT. On a netting account the
Receiver refuses to trade (DryRun still works).

WHAT IS COPIED
  - new market positions (buy/sell, symbol, volume scaled to your settings)
  - stop loss / take profit, and every later change of them
  - partial closes and added volume
  - closes
Each copy carries its own magic number (ReceiverMagic, default 8240124 - change it
if another EA of yours already uses that number) and the comment
"AT24C:<master position id>"; positions you open by hand or with other EAs are
never touched.

NOT COPIED (v1.0.0)
  - pending orders (limit/stop) - only filled positions are copied
  - trailing stops are followed only through the SL values the master reports
  - the master's comments and magic numbers

MT4 DETAILS
  - The Master only publishes market orders (buy/sell), never pending orders.
  - MT4 gives the remaining volume of a partially closed order a NEW ticket. The
    Master keeps publishing the ORIGINAL id for the remainder, so the MT5 Receiver
    follows a partial close with a partial close - not a close and re-open.

MAIN SETTINGS (Receiver)
  LotMode          Multiplier / Fixed lot / Equity ratio (my equity / master equity)
  LotMultiplier    scales the master lot (also scales Equity ratio)
  MaxLotPerTrade   hard cap per copied trade (default 10)
  ReverseCopy      copy buys as sells and the other way round (SL/TP are swapped)
  CopySLTP         copy and follow stop loss / take profit
  CopyExistingOnStart  default OFF: positions already open when the Receiver
                   starts are NOT copied
  MaxEntryDelaySec a trade the master opened longer ago than this is not copied
  MasterSymbolPrefix / MasterSymbolSuffix   what the MASTER broker adds to symbol names
                   (stripped before mapping), e.g. prefix "m." or suffix ".m"
  ReceiverSymbolPrefix / ReceiverSymbolSuffix   what YOUR broker adds, e.g. "#" or "+"
  SymbolMap        explicit pairs that win over the rules above,
                   e.g. XAUUSD=GOLD;US30=DJ30
                   Example: master "m.EURUSD.sd" -> prefix "m." + suffix ".sd" are
                   stripped, then your own prefix/suffix are added.
  AllowedSymbols, MasterMagicFilter   copy only what you want
  StopsPolicy      what to do when your broker's minimum stop distance rejects
                   the master's SL/TP: SKIP the trade (default) or CLAMP
  MaxSpreadPoints, MaxSlippagePoints, DryRun, ExpectedMasterLogin

BUILT-IN SAFETY
  - A Master that is silent for more than StaleSeconds is treated as OFFLINE and
    the Receiver does NOTHING (it never closes positions because a file is old).
  - A partially written file is detected by a checksum and ignored.
  - If the master book becomes empty, copies are closed only after
    EmptySnapshotConfirmSec of continuous emptiness (guards against a terminal
    restart publishing an empty book).
  - At most 3 open attempts per master position; an order whose outcome is
    unknown is not blindly re-sent.
  - Copies stay mappable even if the broker rewrites the position comment or
    (MT4) gives a partially closed order a new ticket.
  - One Receiver per channel and terminal (see SET UP).
  - Not usable in the Strategy Tester (it would be meaningless there).

WHAT WAS TESTED (honest scope)
  - Both EAs compile with 0 errors / 0 warnings (MetaEditor).
  - Protocol self-test inside a real MT4 terminal AND a real MT5 terminal: 47 / 47 checks passed in a real terminal
    each.
  - Cross-platform, cross-broker test: Master = MT4 on an Exness demo (EURUSD),
    Receiver = MT5 hedging account on an Equiti demo (EURUSD.sd; ".sd" added).
    Every step passed: open at half volume, SL/TP change, partial close (the MT4
    remainder kept its id), second position, its close, final close. Measured: 0.2 - 1.5 s
    per action.
  - NOT tested: netting destination accounts, live-money accounts, brokers
    that forbid copying. Test on demo first.

IMPORTANT
  - Trading leveraged products is risky; this tool contains no trading
    strategy and makes no profit claim.
  - Check that your broker allows trade copying and hedging. Copying trades of
    accounts you do not own or manage, or selling signals, can require a
    licence in your country - you are responsible for compliance.
  - Everything stays on your machine: no data is sent to AT24 or anyone else.

AT24 - Algotraders24    https://www.algotraders24.ai
