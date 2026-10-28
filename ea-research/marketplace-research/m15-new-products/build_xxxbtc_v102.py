"""XXX BTC v1.02 = the listed v1.01 (licensed) + the new canvas dashboard. Trading logic is NOT touched.
  python build_xxxbtc_v102.py src <out dir>            -> <out dir>/XXXBTC_v102_licensed.mq5 (to compile next to the AT24 .mqh files and the embedded model)
  python build_xxxbtc_v102.py zip <compiled .ex5> <zip> -> deterministic customer zip (XXXBTC.ex5 + README.txt)
Fixes on the way: the old panel's profit factor was net profit / number of losing trades (wrong); the new one is gross profit / gross loss."""
import hashlib
import json
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
mode = sys.argv[1]


def sub(text, old, new):
    if old not in text:
        raise SystemExit("pattern not found: " + old[:80])
    return text.replace(old, new, 1)


DASH = r'''
//+------------------------------------------------------------------+
//| DASHBOARD (canvas). Refreshed once per second from OnTimer.       |
//| Never shown in the Strategy Tester unless InpDashInTester + visual.|
//+------------------------------------------------------------------+
CCanvas cvs;
bool    g_dashOn = false;
const int DW = 372;
int     g_dashH = 0;

uint DRGB(const int r, const int g, const int b) { return ((uint)255 << 24) | ((uint)r << 16) | ((uint)g << 8) | (uint)b; }
uint dBG()    { return DRGB(12, 17, 30); }
uint dCard()  { return DRGB(21, 29, 48); }
uint dGold()  { return DRGB(255, 196, 64); }
uint dGreen() { return DRGB(46, 204, 113); }
uint dRed()   { return DRGB(231, 76, 60); }
uint dText()  { return DRGB(236, 240, 248); }
uint dDim()   { return DRGB(139, 154, 184); }

bool Dash_Init() {
   g_dashH = 640;
   if(!cvs.CreateBitmapLabel(0, 0, g_prefix + "CANVAS", InpDashX, InpDashY, DW, g_dashH, COLOR_FORMAT_ARGB_NORMALIZE)) return false;
   return true;
}
void Dash_Deinit() { if(g_dashOn) cvs.Destroy(); ObjectsDeleteAll(0, g_prefix); }

void DTx(const int x, const int y, const string s, const uint col, const int size = -90, const bool bold = false, const uint al = TA_LEFT | TA_TOP) {
   cvs.FontSet("Segoe UI", size, bold ? FW_BOLD : FW_NORMAL);
   cvs.TextOut(x, y, s, col, al);
}
void DCardBox(const int y, const int h, const string title) {
   cvs.FillRectangle(8, y, DW - 8, y + h, dCard());
   cvs.FillRectangle(8, y, 11, y + h, dGold());
   DTx(20, y + 5, title, dGold(), -80, true);
}
void DRow(const int y, const string k, const string v, const uint col) {
   DTx(20, y, k, dDim());
   DTx(DW - 20, y, v, col, -90, true, TA_RIGHT | TA_TOP);
}
void DChip(const int x, const int y, const int w, const string label, const bool on) {
   cvs.FillRectangle(x, y, x + w, y + 22, on ? DRGB(24, 94, 56) : DRGB(60, 38, 40));
   DTx(x + w / 2, y + 4, label, on ? dGreen() : dDim(), -80, true, TA_CENTER | TA_TOP);
}

string BlockWhy() {
   if(!AT24Gate_Allowed()) return "licence not valid";
   if(g_isPaused)          return "paused";
   if(IsWeekendBlocked())  return "weekend shield";
   if(IsSpreadBlocked())   return "spread too wide";
   if(InpMaxTradesPerDay > 0 && g_tradesToday >= InpMaxTradesPerDay) return "daily trade limit";
   return "";
}

void DrawFinalDashboard() {
   if(!g_dashOn) return;
   cvs.Erase(dBG());
   string why = BlockWhy();
   bool open = (why == "");

   // header
   cvs.FillRectangle(0, 0, DW, 46, dCard());
   cvs.FillRectangle(0, 0, DW, 3, dGold());
   DTx(14, 8, "XXX BTC  v1.02", dGold(), -110, true);
   DTx(14, 28, _Symbol + "  |  " + EnumToString((ENUM_TIMEFRAMES)InpTF) + "  |  24/7  |  magic " + (string)InpMagicNumber, dDim(), -80);
   cvs.FillRectangle(DW - 132, 12, DW - 10, 34, open ? DRGB(24, 94, 56) : DRGB(110, 36, 30));
   DTx(DW - 71, 15, open ? "ENTRIES ON" : "OFF: " + why, open ? dGreen() : dRed(), -75, true, TA_CENTER | TA_TOP);
   int y = 52;

   // account
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double dayPL = eq - g_dailyStartEquity, dayPct = g_dailyStartEquity > 0 ? dayPL / g_dailyStartEquity * 100.0 : 0.0;
   double dd = g_peakEquity > 0 ? (g_peakEquity - eq) / g_peakEquity * 100.0 : 0.0;
   int spr = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   DCardBox(y, 106, "ACCOUNT");
   DRow(y + 22, "Balance", DoubleToString(bal, 2), dText());
   DRow(y + 40, "Equity", DoubleToString(eq, 2), dText());
   DRow(y + 58, "Today", (dayPL >= 0 ? "+" : "") + DoubleToString(dayPL, 2) + "  (" + DoubleToString(dayPct, 2) + "%)", dayPL >= 0 ? dGreen() : dRed());
   DRow(y + 76, "Drawdown from peak", DoubleToString(dd, 2) + "%", dd < 3 ? dText() : (dd < 8 ? dGold() : dRed()));
   DRow(y + 92 - 2, "Spread / limit (points)", (string)spr + " / " + DoubleToString(InpMaxSpreadPoints, 0), IsSpreadBlocked() ? dRed() : dGreen());
   y += 112;

   // performance (profit factor = gross profit / gross loss)
   double gp = 0, gl = 0; int w = 0, l = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--) {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != (long)InpMagicNumber || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT);
      if(p > 0) { gp += p; w++; } else if(p < 0) { gl -= p; l++; }
   }
   int tt = w + l;
   double wr = tt > 0 ? w * 100.0 / tt : 0.0, pf = gl > 0 ? gp / gl : 0.0;
   DCardBox(y, 70, "PERFORMANCE (this symbol, this magic)");
   DRow(y + 22, "Trades  /  win rate", (string)tt + "  /  " + DoubleToString(wr, 1) + "%", dText());
   DRow(y + 40, "Wins / losses", (string)w + " / " + (string)l, dText());
   DRow(y + 54, "Profit factor", gl > 0 ? DoubleToString(pf, 2) : "n/a", pf >= 1.3 ? dGreen() : (pf >= 1.0 ? dGold() : dRed()));
   y += 76;

   // modules
   DCardBox(y, 56, "MODULES");
   string nm[5] = {"Nova", "Apex", "Zenith", "Pulse", "Eclipse"};
   bool on[5]; on[0] = InpEnableNova; on[1] = InpEnableApex; on[2] = InpEnableZenith; on[3] = InpEnablePulse; on[4] = InpEnableEclipse;
   for(int i = 0; i < 5; i++) DChip(20 + i * 68, y + 26, 64, nm[i], on[i]);
   y += 62;

   // shields
   string ai = (g_ai_status == 1) ? "READY" : ((g_ai_status == 2) ? "FAILED" : "OFF");
   DCardBox(y, 90, "SHIELDS AND LIMITS");
   DRow(y + 22, "Weekend shield (BTC is 24/7)", InpWeekendShield ? "ON" : "OFF", dText());
   DRow(y + 38, "Spread shield", InpSpreadShieldEnabled ? "ON" : "OFF", InpSpreadShieldEnabled ? dGreen() : dDim());
   DRow(y + 54, "Prop mode  /  daily loss limit", (InpPropFirmMode ? "ON" : "off") + "  /  " + (InpDailyLossLimitEnabled ? "ON" : "off"), dText());
   DRow(y + 70, "Trades today  |  AI filter", (string)g_tradesToday + " / " + (string)InpMaxTradesPerDay + "  |  " + ai, dText());
   y += 96;

   // open positions
   int np = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber) np++;
   DCardBox(y, 104, "OPEN POSITIONS  " + (string)np);
   int row = 0;
   for(int i = PositionsTotal() - 1; i >= 0 && row < 4; i--) {
      if(!posInfo.SelectByIndex(i) || posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;
      bool buy = posInfo.PositionType() == POSITION_TYPE_BUY;
      double pl = posInfo.Profit() + posInfo.Swap();
      DTx(20, y + 22 + row * 19, (buy ? "BUY  " : "SELL ") + DoubleToString(posInfo.Volume(), 2) + "  @ " + DoubleToString(posInfo.PriceOpen(), 2), buy ? dGreen() : dRed());
      DTx(DW - 20, y + 22 + row * 19, (pl >= 0 ? "+" : "") + DoubleToString(pl, 2), pl >= 0 ? dGreen() : dRed(), -90, true, TA_RIGHT | TA_TOP);
      row++;
   }
   if(row == 0) DTx(20, y + 24, "no open position", dDim());
   y += 110;

   // last 5 closed trades
   DCardBox(y, 124, "LAST 5 CLOSED TRADES");
   int n = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0 && n < 5; i--) {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != (long)InpMagicNumber || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT);
      datetime t = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
      long dt = HistoryDealGetInteger(tk, DEAL_TYPE);
      DTx(20, y + 22 + n * 19, (dt == DEAL_TYPE_BUY ? "B   " : "S   ") + TimeToString(t, TIME_DATE | TIME_MINUTES), dDim(), -85);
      DTx(DW - 20, y + 22 + n * 19, (p >= 0 ? "+" : "") + DoubleToString(p, 2) + "   " + GetTradeGrade(p), p >= 0 ? dGreen() : dRed(), -85, true, TA_RIGHT | TA_TOP);
      n++;
   }
   if(n == 0) DTx(20, y + 24, "no closed trade yet", dDim());
   y += 130;

   cvs.Update();

   // pause / close buttons stay real chart buttons (a canvas cannot be clicked)
   CreateButton(g_prefix + "BtnPause", InpDashX + 10, InpDashY + y + 4, 170, 28, g_isPaused ? "RESUME" : "PAUSE", clrWhite, g_isPaused ? clrGreen : clrFireBrick);
   CreateButton(g_prefix + "BtnClose", InpDashX + 190, InpDashY + y + 4, 170, 28, "CLOSE ALL", clrWhite, clrDarkOrange);
   ChartRedraw(0);
}
'''

if mode == "src":
    out_dir = sys.argv[2]
    t = open(os.path.join(HERE, "source", "XXXBTC_licensed.mq5"), "rb").read().decode("utf-8-sig").replace("\r\n", "\n")
    t = t.replace("v1.01", "v1.02").replace('#property version   "1.01"', '#property version   "1.02"')
    t = sub(t, "#include <Trade\\PositionInfo.mqh>", "#include <Trade\\PositionInfo.mqh>\n#include <Canvas\\Canvas.mqh>")
    t = sub(t, "input bool   InpShowDashboard        = true;", "input bool   InpShowDashboard        = true;\ninput int    InpDashX                = 10;\ninput int    InpDashY                = 30;\ninput bool   InpDashInTester         = false;   // false = no panel in the Strategy Tester (faster backtests)")
    t = sub(t, "   UpdateStatistics();\n   if(InpShowDashboard) DrawFinalDashboard();\n   ChartRedraw(0);",
            "   g_dashOn = InpShowDashboard && (!MQLInfoInteger(MQL_TESTER) || (InpDashInTester && MQLInfoInteger(MQL_VISUAL_MODE)));\n   if(g_dashOn && !Dash_Init()) g_dashOn = false;\n   UpdateStatistics();\n   if(g_dashOn) DrawFinalDashboard();\n   ChartRedraw(0);")
    t = sub(t, "void OnDeinit(const int reason) {\n   EventKillTimer();\n   ObjectsDeleteAll(0, g_prefix);", "void OnDeinit(const int reason) {\n   Dash_Deinit();\n   EventKillTimer();")
    t = sub(t, "   UpdateStatistics();\n   if(InpShowDashboard) DrawFinalDashboard();\n   ChartRedraw(0);\n}", "   if(g_dashOn) { UpdateStatistics(); DrawFinalDashboard(); }\n}")
    a = t.index("void DrawFinalDashboard() {")
    b = t.index("void CreateModuleRowCompact")
    t = t[:a] + DASH.lstrip("\n") + "\n" + t[b:]
    os.makedirs(out_dir, exist_ok=True)
    t = t.replace("XXXBTC_licensed", "XXXBTC_v102_licensed")
    open(os.path.join(out_dir, "XXXBTC_v102_licensed.mq5"), "wb").write(("﻿" + t.replace("\n", "\r\n")).encode("utf-8"))
    print("written", len(t))

elif mode == "zip":
    ex5, out = sys.argv[2:4]
    README = """XXX BTC v1.02  -  24/7 breakout Expert Advisor for Bitcoin (BTCUSD), MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES
  XXXBTC.ex5   the Expert Advisor (the optional AI model is built in - no model files to copy)

LICENCE KEY (required)
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA to a BTCUSD M15 chart, Allow Algo Trading, paste the key into InpLicenseKey.
  One key works on ONE trading account at a time and only for this product. To move it: Dashboard > Purchases > this
  product > "Change trading account" (2 changes per 30 days). The EA checks the key at start and every 4 hours; if it is
  revoked or used on another account it stops opening NEW trades (open trades are still managed). A short internet
  outage never stops a running EA (72 hours of grace). The Strategy Tester needs no key.

WHAT IS NEW IN v1.02
  * A new chart dashboard: status chip (entries on / off and the reason), account, drawdown, spread, performance, module
    switches, shields and limits, open positions and the last 5 closed trades. Pause and Close-All buttons below it.
  * The profit factor on the panel is now gross profit / gross loss (the old panel divided the net profit by the number of
    losing trades, which was wrong).
  * The trading logic is unchanged from v1.01. The dashboard is never drawn in the Strategy Tester unless you switch
    InpDashInTester on and use visual mode.

READ THIS
  * The marketplace evidence belongs to the tested configuration of this product. Use the settings file of the listing to
    reproduce it. Start on a DEMO account with a small lot. Past performance is not a guarantee of future results.
    Trading leveraged products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""
    files = [("XXXBTC.ex5", open(ex5, "rb").read()), ("README.txt", README.replace("\n", "\r\n").encode("utf-8"))]
    manifest = {"version": "1.02", "files": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 29, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            manifest["files"][name] = hashlib.sha256(data).hexdigest()
    manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
    json.dump(manifest, open(out + ".manifest.json", "w"), indent=2)
    print(out, manifest["zipSha256"][:16])
