"""Generates package/<direction>/README.txt for every copier direction from one template, and the icons.
Latency ranges are parsed from the real result files in results/, never typed by hand.
Usage: python build_readmes.py"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ICON_DIR = os.path.join(HERE, "..", "marketplace-research", "m16-copier", "branding")


def latency_range(results_file):
    txt = open(os.path.join(HERE, "results", results_file), encoding="utf-8").read()
    vals = [int(m.group(2)) for m in re.finditer(r"^PASS\s+(\w+)\s+latency (\d+) ms", txt, re.M) if m.group(1) != "CLOSE_BUY"]
    return "%.1f - %.1f s" % (min(vals) / 1000.0, max(vals) / 1000.0)


SELFTEST = "47 / 47 checks passed in a real terminal"

D = {
    "MT5_to_MT5": dict(
        frm="MT5", to="MT5", master="AT24_Copier_Master_MT5.ex5", recv="AT24_Copier_Receiver_MT5.ex5",
        mfold="MQL5", rfold="MQL5", mname="AT24_Copier_Master_MT5", rname="AT24_Copier_Receiver_MT5",
        dest_req="THE DESTINATION ACCOUNT MUST BE A HEDGING ACCOUNT. On a netting account the\nReceiver refuses to trade (DryRun still works). The Master only reads the source\naccount; a netting SOURCE account has not been tested.",
        extra="",
        tested="""  - Compiles with 0 errors / 0 warnings (MetaEditor).
  - Protocol self-test inside a real MT5 terminal: %s (CRC-32, tamper and
    partial-write detection, symbol prefix/suffix mapping, lot maths...).
  - End-to-end test on a real MT5 HEDGING DEMO account (loopback: Master and
    Receiver on one terminal): open, SL/TP change, partial close, second
    position, close, nothing left behind - 17 / 17 checks passed, in normal AND
    in ReverseCopy mode.
  - Cross-broker test with TWO SEPARATE MT5 terminals: Master on an Equiti demo
    (symbol EURUSD.sd), Receiver on an Exness demo (EURUSD; ".sd" stripped).
    Every step passed: open at half volume, SL/TP change, partial close, second
    position, its close, final close. A position that already existed on the
    receiving account was left untouched. Measured: %s per action.""" % (SELFTEST, "%LAT%"),
        lat="e2e_mt5_to_mt5_cross_broker_equiti_to_exness.txt",
        nottested="  - NOT tested: netting source accounts, live-money accounts, brokers that\n    forbid hedging or copying. Test on demo first.",
    ),
    "MT5_to_MT4": dict(
        frm="MT5", to="MT4", master="AT24_Copier_Master_MT5.ex5", recv="AT24_Copier_Receiver_MT4.ex4",
        mfold="MQL5", rfold="MQL4", mname="AT24_Copier_Master_MT5", rname="AT24_Copier_Receiver_MT4",
        dest_req="THE DESTINATION BROKER MUST ALLOW HEDGING (opposite orders on one symbol) and must\nnot enforce a FIFO rule. If it does, the Receiver logs \"hedging prohibited\" /\n\"FIFO rule\" and that copy is not opened. Tested on an Exness MT4 demo.",
        extra="""MT4 DETAILS
  - Only market orders (buy/sell) are copied, never pending orders.
  - MT4 gives the remaining volume of a partially closed order a NEW ticket and
    often a new comment. The Receiver keeps every copy linked to its master
    position anyway (it recorded the link when it opened the copy and re-links
    the remainder), so a partial close on the master is followed by a partial
    close of the copy - not by a close and re-open.
  - ReceiverMagic is an integer on MT4.
""",
        tested="""  - Both EAs compile with 0 errors / 0 warnings (MetaEditor).
  - Protocol self-test inside a real MT5 terminal AND a real MT4 terminal: %s
    each (CRC-32, tamper detection, prefix/suffix mapping, lot maths...). Running
    it in MT4 found a real MT4 difference (StringTrim does not edit in place),
    which is fixed in this version.
  - Cross-platform, cross-broker test: Master = MT5 on an Equiti demo
    (EURUSD.sd), Receiver = MT4 on an Exness demo (EURUSD; ".sd" stripped). Every
    step passed: open at half volume, SL/TP change, partial close (MT4 gave the
    remainder a new ticket and the Receiver followed it), second position, its
    close, final close. Measured: %s per action.
  - A duplicate-copy bug was found in the first MT4 run (two Receivers were
    attached to one channel by accident) and led to the built-in
    one-Receiver-per-channel lock; the final run attached the Receiver to three
    charts on purpose and only one acted.""" % (SELFTEST, "%LAT%"),
        lat="e2e_mt5_to_mt4_cross_broker_equiti_to_exness.txt",
        nottested="  - NOT tested: brokers with a FIFO rule or hedging prohibited, live-money\n    accounts, brokers that forbid copying. Test on demo first.",
    ),
    "MT4_to_MT4": dict(
        frm="MT4", to="MT4", master="AT24_Copier_Master_MT4.ex4", recv="AT24_Copier_Receiver_MT4.ex4",
        mfold="MQL4", rfold="MQL4", mname="AT24_Copier_Master_MT4", rname="AT24_Copier_Receiver_MT4",
        dest_req="THE DESTINATION BROKER MUST ALLOW HEDGING (opposite orders on one symbol) and must\nnot enforce a FIFO rule. If it does, the Receiver logs \"hedging prohibited\" /\n\"FIFO rule\" and that copy is not opened. Tested on an Exness MT4 demo.",
        extra="""MT4 DETAILS
  - Only market orders (buy/sell) are copied, never pending orders.
  - MT4 gives the remaining volume of a partially closed order a NEW ticket. The
    Master keeps publishing the ORIGINAL id for the remainder, and the Receiver
    keeps every copy linked to it, so a partial close on the master is followed by
    a partial close of the copy - not by a close and re-open.
  - ReceiverMagic and the master magic are integers on MT4.
""",
        tested="""  - Both EAs compile with 0 errors / 0 warnings (MetaEditor).
  - Protocol self-test inside a real MT4 terminal: %s.
  - Loopback test inside ONE MT4 terminal on an Exness DEMO account (Master and
    Receiver on two charts, the Receiver copying the Master's trades onto the same
    account): open, SL/TP change, partial close (the Master's remainder got a new
    ticket and kept its id), second position, closes, nothing left behind - all
    steps passed. Measured: %s per action (slower than two terminals because
    everything runs in one terminal).
  - A duplicate-copy bug found in the MT4 tests (two Receivers on one channel)
    led to the built-in one-Receiver-per-channel lock.""" % (SELFTEST, "%LAT%"),
        lat="e2e_mt4_to_mt4_loopback_exness.txt",
        nottested="  - NOT tested: two separate MT4 terminals on different brokers (only one MT4\n    demo terminal was available), brokers with a FIFO rule or hedging\n    prohibited, live-money accounts. Test on demo first.",
    ),
    "MT4_to_MT5": dict(
        frm="MT4", to="MT5", master="AT24_Copier_Master_MT4.ex4", recv="AT24_Copier_Receiver_MT5.ex5",
        mfold="MQL4", rfold="MQL5", mname="AT24_Copier_Master_MT4", rname="AT24_Copier_Receiver_MT5",
        dest_req="THE DESTINATION ACCOUNT MUST BE A HEDGING ACCOUNT. On a netting account the\nReceiver refuses to trade (DryRun still works).",
        extra="""MT4 DETAILS
  - The Master only publishes market orders (buy/sell), never pending orders.
  - MT4 gives the remaining volume of a partially closed order a NEW ticket. The
    Master keeps publishing the ORIGINAL id for the remainder, so the MT5 Receiver
    follows a partial close with a partial close - not a close and re-open.
""",
        tested="""  - Both EAs compile with 0 errors / 0 warnings (MetaEditor).
  - Protocol self-test inside a real MT4 terminal AND a real MT5 terminal: %s
    each.
  - Cross-platform, cross-broker test: Master = MT4 on an Exness demo (EURUSD),
    Receiver = MT5 hedging account on an Equiti demo (EURUSD.sd; ".sd" added).
    Every step passed: open at half volume, SL/TP change, partial close (the MT4
    remainder kept its id), second position, its close, final close. Measured: %s
    per action.""" % (SELFTEST, "%LAT%"),
        lat="e2e_mt4_to_mt5_cross_broker_exness_to_equiti.txt",
        nottested="  - NOT tested: netting destination accounts, live-money accounts, brokers\n    that forbid copying. Test on demo first.",
    ),
}

TEMPLATE = """AT24 LOCAL TRADE COPIER  -  {frm} to {to}  -  v1.0.0
=================================================================
Copies the open positions of one MetaTrader {fn} account to another
MetaTrader {tn} account on the SAME computer (or the same VPS).
No server, no DLL, no internet connection and no account password is
used: the two terminals exchange a small text file in the shared
"Common\\Files" folder (MT4 and MT5 both use it, so both terminals must run
under the same Windows user).

WHAT YOU GET
  {master:<32}- attach in the {frm} terminal you want to COPY FROM
  {recv:<32}- attach in the {to} terminal you want to COPY TO

SET UP (about 3 minutes)
 1. Copy {master} into the {mfold}\\Experts folder of the SOURCE terminal and
    {recv} into the {rfold}\\Experts folder of the DESTINATION terminal
    (File > Open Data Folder > {mfold}/{rfold} > Experts), restart or refresh.
 2. SOURCE terminal: drag "{mname}" onto any chart.
    Set ChannelId (e.g. "gold1"). The Master only READS positions - it never
    sends an order.
 3. DESTINATION terminal: drag "{rname}" onto any chart.
    Set the SAME ChannelId. Allow trading: the AutoTrading / Algo Trading
    toolbar button and "Allow live trading" / "Allow Algo Trading" in the EA
    properties.
 4. The chart comment shows the live status: master found / offline, copies
    opened, closed, SL/TP updates, skipped, errors.
 5. START ON A DEMO ACCOUNT FIRST and use the Receiver's DryRun option to see
    what it would do before it sends any order.
 Only ONE Receiver may run per channel in a terminal: a second one detects the
 first and does nothing (otherwise every trade would be copied twice).

{dest_req}

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

{extra}MAIN SETTINGS (Receiver)
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
{tested}
{nottested}

IMPORTANT
  - Trading leveraged products is risky; this tool contains no trading
    strategy and makes no profit claim.
  - Check that your broker allows trade copying and hedging. Copying trades of
    accounts you do not own or manage, or selling signals, can require a
    licence in your country - you are responsible for compliance.
  - Everything stays on your machine: no data is sent to AT24 or anyone else.

AT24 - Algotraders24    https://www.algotraders24.ai
"""

for key, d in D.items():
    lat = latency_range(d["lat"])
    text = TEMPLATE.format(
        frm=d["frm"], to=d["to"], fn=d["frm"][2], tn=d["to"][2], master=d["master"], recv=d["recv"],
        mfold=d["mfold"], rfold=d["rfold"], mname=d["mname"], rname=d["rname"], dest_req=d["dest_req"],
        extra=d["extra"] + ("\n" if d["extra"] else ""), tested=d["tested"].replace("%LAT%", lat), nottested=d["nottested"])
    out = os.path.join(HERE, "package", key)
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "README.txt"), "w", encoding="utf-8", newline="\r\n").write(text)
    print(key, "README ok, latency", lat)

# icons: same artwork, direction label changes
src = open(os.path.join(ICON_DIR, "copier-mt5-to-mt5-icon.svg"), encoding="utf-8").read()
for key, d in D.items():
    svg = src.replace("MT5  ›  MT5  ·  LOCAL", "%s  ›  %s  ·  LOCAL" % (d["frm"], d["to"]))
    open(os.path.join(ICON_DIR, "copier-%s-to-%s-icon.svg" % (d["frm"].lower(), d["to"].lower())), "w", encoding="utf-8").write(svg)
print("icons ok")
