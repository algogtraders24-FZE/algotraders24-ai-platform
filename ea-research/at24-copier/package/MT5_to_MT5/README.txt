AT24 LOCAL TRADE COPIER  -  MT5 to MT5  -  v1.0.0
=================================================================
Copies the open positions of one MetaTrader 5 account to another
MetaTrader 5 account on the SAME computer (or the same VPS).
No server, no DLL, no internet connection and no account password is
used: the two terminals exchange a small text file in the shared
"Common\Files" folder.

WHAT YOU GET
  AT24_Copier_Master_MT5.ex5    - attach in the terminal you want to COPY FROM
  AT24_Copier_Receiver_MT5.ex5  - attach in the terminal you want to COPY TO

SET UP (about 3 minutes)
 1. Copy both .ex5 files into the MQL5\Experts folder of the matching
    terminal (File > Open Data Folder > MQL5 > Experts), restart or refresh.
 2. SOURCE terminal: drag "AT24_Copier_Master_MT5" onto any chart.
    Set ChannelId (e.g. "gold1"). The Master only READS positions - it never
    sends an order.
 3. DESTINATION terminal: drag "AT24_Copier_Receiver_MT5" onto any chart.
    Set the SAME ChannelId. Allow Algo Trading (button in the toolbar and
    "Allow Algo Trading" in the EA properties).
 4. The chart comment shows the live status: master found / offline, copies
    opened, closed, SL/TP updates, skipped, errors.
 5. START ON A DEMO ACCOUNT FIRST and use the Receiver's DryRun option to see
    what it would do before it sends any order.

THE DESTINATION ACCOUNT MUST BE A HEDGING ACCOUNT. On a netting account the
Receiver refuses to trade (DryRun still works). The Master only reads the source
account; a netting SOURCE account has not been tested.

WHAT IS COPIED
  - new market positions (buy/sell, symbol, volume scaled to your settings)
  - stop loss / take profit, and every later change of them
  - partial closes and added volume
  - closes
Each copy carries its own magic number (ReceiverMagic) and the comment
"AT24C:<master position id>"; positions you open by hand or with other EAs are
never touched.

NOT COPIED (v1.0.0)
  - pending orders (limit/stop) - only filled positions are copied
  - trailing stops are followed only through the SL values the master reports
  - the master's comments and magic numbers

MAIN SETTINGS (Receiver)
  LotMode          Multiplier / Fixed lot / Equity ratio (my equity / master equity)
  LotMultiplier    scales the master lot (also scales Equity ratio)
  MaxLotPerTrade   hard cap per copied trade (default 10)
  ReverseCopy      copy buys as sells and the other way round (SL/TP are swapped)
  CopySLTP         copy and follow stop loss / take profit
  CopyExistingOnStart  default OFF: positions already open when the Receiver
                   starts are NOT copied
  MaxEntryDelaySec a trade the master opened longer ago than this is not copied
  MasterSymbolSuffix / ReceiverSymbolSuffix / SymbolMap
                   e.g. strip ".m" and add "+", or XAUUSD=GOLD;US30=DJ30
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
  - Copies stay mappable even if the broker rewrites the position comment
    (verified: one broker blanks it after a partial close).
  - Not usable in the Strategy Tester (it would be meaningless there).

WHAT WAS TESTED (honest scope)
  - Compiles with 0 errors / 0 warnings (MetaEditor, build 6182).
  - Protocol self-test inside a real MT5 terminal: 41 / 41 checks passed
    (CRC-32, tamper and partial-write detection, symbol mapping, lot maths...).
  - End-to-end test on a real MT5 HEDGING DEMO account (loopback: Master and
    Receiver on one terminal): open, SL/TP change, partial close, second
    position, close, nothing left behind - 17 / 17 checks passed, in normal AND
    in ReverseCopy mode. Measured on that demo: new position copied in about
    0.3 - 0.5 s, SL/TP/partial-close changes in about 0.2 - 0.6 s. Your speed
    depends on your PC and broker; these are not guarantees.
  - NOT tested: separate terminals from different brokers on this build,
    netting source accounts, live-money accounts, brokers that forbid hedging
    or copying. Test on demo first.

IMPORTANT
  - Trading leveraged products is risky; this tool contains no trading
    strategy and makes no profit claim.
  - Check that your broker allows trade copying and hedging. Copying trades of
    accounts you do not own or manage, or selling signals, can require a
    licence in your country - you are responsible for compliance.
  - Everything stays on your machine: no data is sent to AT24 or anyone else.

AT24 - Algotraders24    https://www.algotraders24.ai
