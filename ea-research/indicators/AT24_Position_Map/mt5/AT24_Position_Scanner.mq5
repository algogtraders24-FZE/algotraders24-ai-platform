//+------------------------------------------------------------------+
//| AT24 Position Scanner (MT5)                                      |
//| One table for many symbols, built on the same verified engine as |
//| AT24 Position Map: the weekly trend, what the rules are waiting |
//| for (pullback, H4 turn, trigger), the plan with entry / stop /   |
//| target 1:3 and the risk in weekly ATR, and the 1:3 record of the |
//| same rules on each symbol's own history. Closed bars only.       |
//| A research and planning tool. Places no trades. Not advice.      |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Position Scanner - the weekly-structure + H4-turn rules of AT24 Position Map applied to a list of symbols in one table: trend, what the rules wait for, plan levels, risk and the 1:3 record per symbol."
#property description "It places no trades. Results on past bars do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots   0

#include "AT24_PM_Core.mqh"

#resource "pm_logo56.bmp"

input group "=== Symbols ==="
input string InpSymbols       = "EURUSD,GBPUSD,USDJPY,AUDUSD,NZDUSD,USDCAD,USDCHF,EURJPY,GBPJPY,XAUUSD,XAGUSD,USOIL,US30,US500,USTEC"; // Symbols (comma separated, up to 24)
input string InpSuffix        = "";     // Broker suffix added to every symbol (for example .m or _x)
input group "=== Rules (same as Position Map) ==="
input int    InpSwingW        = 2;      // Swing bars each side: weekly
input int    InpSwingH        = 3;      // Swing bars each side: H4 (entry)
input double InpMinSwingAtr   = 0.75;   // Smallest swing in ATR(14) of its timeframe
input double InpMinRetrace    = 0.382;  // Smallest pullback as a share of the last weekly leg
input double InpStopBufAtr    = 0.25;   // Stop buffer beyond the pullback extreme in ATR(14) of H4
input double InpRR1           = 3.0;    // Target 1 as a multiple of the risk (1:3)
input int    InpTimeStopWeeks = 8;      // Weeks before a trade that hit neither stop nor target is closed
input bool   InpUseSwap       = true;   // Include the broker swap of the holding time in the record
input group "=== History ==="
input int    InpH4Bars        = 4500;   // H4 bars analysed per symbol
input int    InpWeeklyBars    = 400;    // Weekly bars analysed per symbol
input group "=== Alerts (bar close) ==="
input bool   InpAlertTrigger  = false;  // Alert when a symbol triggers on a closed H4 bar
input bool   InpAlertTurn     = false;  // Alert when a symbol forms its H4 turn (a trigger is one close away)
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input bool   InpDebugLog      = false;  // Print each symbol rebuild to the Experts log
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

#define MAXSYM 24

struct PsRow
  {
   string   sym;
   int      state;        // 0 not built yet, 1 ok, 2 loading history, 3 no data / symbol missing
   int      fails;
   int      trendW;       // +1 / -1 / 0
   int      stage;        // 0-4 as in AT24PM_Ctx
   int      dir;
   double   depth;
   double   B;
   bool     live, pending;
   double   entry, sl, tp1, risk, atrW;
   int      n3;
   double   avg3, p3;
   datetime h4bar;        // forming H4 bar time when this row was built
   uint     tryMs;        // do not retry before this GetTickCount value
   datetime alertBar;     // H4 bar of the last alert for this row
   int      lastStage;
   uint     ms;
  };

double B0[];
string PFX = "AT24PS_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
PsRow  gRow[MAXSYM];
int    gN = 0;
int    gDigitsMax = 5;

#define DASH_W 800
#define COL_SYM 10
#define COL_W1 98
#define COL_WAIT 150
#define COL_ENTRY 410
#define COL_STOP 490
#define COL_TP 570
#define COL_RISK 650
#define COL_REC 715

int DashH() { return 78 + 16 * MathMax(gN, 1) + 74; }

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - DASH_W - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - DashH() - InpDashY) : InpDashY;
  }

void MakeLabel(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetString(0, n, OBJPROP_FONT, bold ? "Segoe UI Semibold" : "Segoe UI");
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, n, OBJPROP_TEXT, txt == "" ? " " : txt);
  }

void BuildFrame()
  {
   CalcBase();
   string n = PFX + "bg";
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, DASH_W);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, DashH());
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::pm_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string TrendTxt(const int t) { return t > 0 ? "UP" : (t < 0 ? "DOWN" : "RANGE"); }
color  TrendCol(const int t) { return t > 0 ? clrLimeGreen : (t < 0 ? clrTomato : clrSlateGray); }

//--- broker swap as a COST in price units per calendar day (positive = cost), for any symbol
double SwapCostPerDay(const string sym, const bool isLong)
  {
   if(!InpUseSwap) return 0.0;
   double sw = SymbolInfoDouble(sym, isLong ? SYMBOL_SWAP_LONG : SYMBOL_SWAP_SHORT);
   long mode = SymbolInfoInteger(sym, SYMBOL_SWAP_MODE);
   double tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), pt = SymbolInfoDouble(sym, SYMBOL_POINT);
   double cost = 0.0;
   if(mode == SYMBOL_SWAP_MODE_POINTS) cost = -sw * pt;
   else if(mode == SYMBOL_SWAP_MODE_CURRENCY_SYMBOL || mode == SYMBOL_SWAP_MODE_CURRENCY_MARGIN || mode == SYMBOL_SWAP_MODE_CURRENCY_DEPOSIT) { if(tv > 0.0 && ts > 0.0) cost = -sw / (tv / ts); }
   else if(mode == SYMBOL_SWAP_MODE_INTEREST_CURRENT || mode == SYMBOL_SWAP_MODE_INTEREST_OPEN) cost = -sw / 100.0 * SymbolInfoDouble(sym, SYMBOL_BID) / 365.0;
   return cost * 9.0 / 7.0;
  }

//--- rebuild one symbol: the same chain as the Position Map (swings, scan, Eval, 1:3 record)
void BuildRow(PsRow &r)
  {
   uint t0 = GetTickCount();
   if(!SymbolSelect(r.sym, true)) { r.state = 3; r.tryMs = GetTickCount() + 300000; return; }
   MqlRates rw[], rh[];
   int nW = CopyRates(r.sym, PERIOD_W1, 1, MathMax(InpWeeklyBars, 100), rw);
   int nH = CopyRates(r.sym, PERIOD_H4, 1, MathMax(InpH4Bars, 1000), rh);
   if(nW < 60 || nH < 600)
     {
      r.fails++;
      r.state = (r.fails >= 4 && nH <= 0) ? 3 : 2;
      r.tryMs = GetTickCount() + (r.state == 3 ? 300000 : 8000);
      return;
     }
   r.fails = 0;
   datetime tW[], tH[]; double hW[], lW[], cW[], oH[], hH[], lH[], cH[], aW[], aH[];
   ArrayResize(tW, nW); ArrayResize(hW, nW); ArrayResize(lW, nW); ArrayResize(cW, nW);
   ArrayResize(tH, nH); ArrayResize(oH, nH); ArrayResize(hH, nH); ArrayResize(lH, nH); ArrayResize(cH, nH);
   for(int i = 0; i < nW; i++) { tW[i] = rw[i].time; hW[i] = rw[i].high; lW[i] = rw[i].low; cW[i] = rw[i].close; }
   for(int i = 0; i < nH; i++) { tH[i] = rh[i].time; oH[i] = rh[i].open; hH[i] = rh[i].high; lH[i] = rh[i].low; cH[i] = rh[i].close; }
   double cost = SymbolInfoDouble(r.sym, SYMBOL_ASK) - SymbolInfoDouble(r.sym, SYMBOL_BID);
   if(cost < 0.0) cost = 0.0;
   AT24PM_Params p;
   p.kW = InpSwingW; p.kD = 3; p.kH = InpSwingH; p.minSwingAtr = InpMinSwingAtr; p.minRetrace = InpMinRetrace; p.stopBufAtr = InpStopBufAtr;
   p.rr1 = InpRR1; p.rr2 = InpRR1 + 1.0; p.rr3 = InpRR1 + 2.0; p.timeStopWeeks = InpTimeStopWeeks; p.cost = cost; p.swapLong = SwapCostPerDay(r.sym, true); p.swapShort = SwapCostPerDay(r.sym, false);
   AT24PM_Atr(nW, hW, lW, cW, aW); AT24PM_Atr(nH, hH, lH, cH, aH);
   AT24PM_Swing sW[], sH[];
   int cW_ = AT24PM_Swings(nW, hW, lW, cW, aW, p.kW, p.minSwingAtr, sW);
   int cH_ = AT24PM_Swings(nH, hH, lH, cH, aH, p.kH, p.minSwingAtr, sH);
   AT24PM_Plan pl[]; int np = AT24PM_Run(nW, tW, hW, lW, cW, nH, tH, oH, hH, lH, cH, p, pl);
   AT24PM_Score sc; AT24PM_ScoreOf(pl, np, 20261117, false, 0, sc);
   AT24PM_Ctx x; AT24PM_Eval(nH - 1, nW, tW, sW, cW_, nH, tH, hH, lH, cH, sH, cH_, p, x);
   r.trendW = AT24PM_Trend(sW, cW_, nW - 1);
   r.stage = x.stage; r.dir = x.dir; r.depth = x.depth; r.B = x.B;
   r.atrW = aW[nW - 1];
   r.live = false; r.pending = false; r.entry = 0.0; r.sl = 0.0; r.tp1 = 0.0; r.risk = 0.0;
   if(np > 0)
     {
      AT24PM_Plan q = pl[np - 1];
      if(q.status == 3) { r.live = true; r.pending = true; }
      else if(q.status == 1 && (q.st[0] == 2 || q.st[1] == 2 || q.st[2] == 2)) r.live = true;
      if(r.live)
        {
         r.entry = r.pending ? cH[nH - 1] : q.entry; r.sl = q.sl; r.risk = MathAbs(r.entry - q.sl);
         r.tp1 = r.entry + q.dir * InpRR1 * r.risk;
         r.dir = q.dir;
        }
     }
   r.n3 = sc.n; r.avg3 = sc.avgR; r.p3 = sc.pFlip;
   r.state = 1;
   r.h4bar = iTime(r.sym, PERIOD_H4, 0);
   r.ms = GetTickCount() - t0;
   if(InpDebugLog) PrintFormat("AT24PS %s W1=%d stage=%d depth=%.3f live=%d pending=%d entry=%.5f sl=%.5f n3=%d avg3=%+.4f setups=%d ms=%u", r.sym, r.trendW, r.stage, r.depth, (int)r.live, (int)r.pending, r.entry, r.sl, r.n3, r.avg3, np, r.ms);
  }

//--- what the rules wait for, in at most 38 characters
string WaitTxt(const PsRow &r, color &c)
  {
   int dg = (int)SymbolInfoInteger(r.sym, SYMBOL_DIGITS);
   if(r.state == 3) { c = clrSlateGray; return "no data / symbol not found"; }
   if(r.state != 1) { c = clrSlateGray; return "loading history"; }
   if(r.live && r.pending) { c = clrGold; return StringFormat("TRIGGER: %s, entry next open", r.dir > 0 ? "LONG" : "SHORT"); }
   if(r.live) { c = clrSilver; return StringFormat("%s plan running", r.dir > 0 ? "long" : "short"); }
   c = r.trendW > 0 ? clrLimeGreen : (r.trendW < 0 ? clrTomato : clrSlateGray);
   if(r.trendW == 0) return "weekly range: no trade";
   switch(r.stage)
     {
      case 1: return StringFormat("waiting for a pullback (%.0f %%)", MathMax(0.0, r.depth) * 100.0);
      case 2: return StringFormat("pullback %.0f %%: wait H4 turn", r.depth * 100.0);
      case 3: c = clrGold; return StringFormat("H4 turn: close %s %s", r.dir > 0 ? "above" : "below", DoubleToString(r.B, dg));
      case 4: c = clrGold; return "close beyond B on the last bar";
     }
   return "";
  }

int Priority(const PsRow &r)
  {
   if(r.state != 1) return 7;
   if(r.live && r.pending) return 0;
   if(!r.live && r.trendW != 0 && r.stage == 3) return 1;
   if(!r.live && r.trendW != 0 && r.stage == 2) return 2;
   if(r.live) return 3;
   if(r.trendW != 0 && r.stage == 1) return 4;
   return 5;
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 POSITION SCANNER", C'230,190,80', 10, true);
   int ok = 0, trig = 0, turn = 0;
   for(int i = 0; i < gN; i++) { if(gRow[i].state == 1) ok++; if(Priority(gRow[i]) == 0) trig++; if(Priority(gRow[i]) == 1) turn++; }
   MakeLabel("t2", 70, 26, StringFormat("%d of %d symbols read    %d triggered    %d with an H4 turn", ok, gN, trig, turn), clrSilver, 9);
   MakeLabel("t3", 70, 42, "weekly structure gives the direction; the H4 turn is the entry", clrSlateGray, 8);
   int y = 62;
   MakeLabel("h0", COL_SYM, y, "SYMBOL", C'230,190,80', 8, true);
   MakeLabel("h1", COL_W1, y, "WEEKLY", C'230,190,80', 8, true);
   MakeLabel("h2", COL_WAIT, y, "WHAT THE RULES WAIT FOR", C'230,190,80', 8, true);
   MakeLabel("h3", COL_ENTRY, y, "ENTRY", C'230,190,80', 8, true);
   MakeLabel("h4", COL_STOP, y, "STOP", C'230,190,80', 8, true);
   MakeLabel("h5", COL_TP, y, StringFormat("TP 1:%.0f", InpRR1), C'230,190,80', 8, true);
   MakeLabel("h6", COL_RISK, y, "RISK", C'230,190,80', 8, true);
   MakeLabel("h7", COL_REC, y, StringFormat("RECORD 1:%.0f", InpRR1), C'230,190,80', 8, true);
   //--- order: by priority, then by the input order
   int ord[MAXSYM]; for(int i = 0; i < gN; i++) ord[i] = i;
   for(int i = 1; i < gN; i++) { int a = ord[i], j = i - 1; while(j >= 0 && Priority(gRow[ord[j]]) > Priority(gRow[a])) { ord[j + 1] = ord[j]; j--; } ord[j + 1] = a; }
   for(int k = 0; k < gN; k++)
     {
      PsRow r = gRow[ord[k]];
      int yy = 80 + k * 16;
      string id = IntegerToString(k);
      int dg = (int)SymbolInfoInteger(r.sym, SYMBOL_DIGITS);
      color wc; string w = WaitTxt(r, wc);
      MakeLabel("r0" + id, COL_SYM, yy, r.sym, clrWhite, 8, true);
      MakeLabel("r1" + id, COL_W1, yy, r.state == 1 ? TrendTxt(r.trendW) : "-", r.state == 1 ? TrendCol(r.trendW) : clrSlateGray, 8, true);
      MakeLabel("r2" + id, COL_WAIT, yy, w, wc, 8, Priority(r) <= 1);
      if(r.state == 1 && r.live)
        {
         MakeLabel("r3" + id, COL_ENTRY, yy, DoubleToString(r.entry, dg), clrWhite, 8);
         MakeLabel("r4" + id, COL_STOP, yy, DoubleToString(r.sl, dg), clrTomato, 8);
         MakeLabel("r5" + id, COL_TP, yy, DoubleToString(r.tp1, dg), clrLimeGreen, 8);
         double wr = r.risk / MathMax(r.atrW, SymbolInfoDouble(r.sym, SYMBOL_POINT));
         MakeLabel("r6" + id, COL_RISK, yy, StringFormat("%.1f wk ATR", wr), wr > 2.5 ? clrGold : clrSilver, 8);
        }
      else
        {
         MakeLabel("r3" + id, COL_ENTRY, yy, "-", clrSlateGray, 8); MakeLabel("r4" + id, COL_STOP, yy, "-", clrSlateGray, 8);
         MakeLabel("r5" + id, COL_TP, yy, "-", clrSlateGray, 8); MakeLabel("r6" + id, COL_RISK, yy, "-", clrSlateGray, 8);
        }
      string rec = (r.state == 1) ? (r.n3 < 30 ? StringFormat("%+.2f R (%d)", r.avg3, r.n3) : StringFormat("%+.2f R  n=%d", r.avg3, r.n3)) : "-";
      MakeLabel("r7" + id, COL_REC, yy, rec, r.state == 1 && r.n3 >= 30 ? (r.avg3 > 0.0 && r.p3 < 0.05 ? clrLimeGreen : clrSilver) : clrSlateGray, 8);
     }
   int fy = 80 + gN * 16 + 8;
   MakeLabel("n1", 10, fy, "Record = average R of the same rules on the symbol's", clrSlateGray, 8);
   MakeLabel("n2", 10, fy + 13, "own H4 history. Under 30 setups: no claim (n shown).", clrSlateGray, 8);
   MakeLabel("n3", 10, fy + 26, "Past results do not predict future results.", clrSlateGray, 8);
   MakeLabel("f1", 10, DashH() - 13, "Planning tool, not a signal. algotraders24.ai", clrSlateGray, 7);
  }

void Notify(const PsRow &r, const string what)
  {
   string msg = StringFormat("AT24 Position Scanner %s: %s", r.sym, what);
   Alert(msg);
   if(InpAlertPush) SendNotification(msg);
  }

//--- one symbol per timer tick: the first one that was never built, or whose H4 bar changed, or whose retry time has come
void Step()
  {
   for(int k = 0; k < gN; k++)
     {
      PsRow r = gRow[k];
      bool due = false;
      if(r.state == 0) due = true;
      else if(r.state == 1) due = (iTime(r.sym, PERIOD_H4, 0) != r.h4bar && iTime(r.sym, PERIOD_H4, 0) > 0);
      else due = ((int)(GetTickCount() - r.tryMs) >= 0);
      if(!due) continue;
      int prevStage = gRow[k].lastStage;
      BuildRow(gRow[k]);
      if(gRow[k].state == 1)
        {
         PsRow n = gRow[k];
         if(InpAlertTrigger && n.live && n.pending && n.alertBar != n.h4bar) { gRow[k].alertBar = n.h4bar; Notify(n, StringFormat("%s trigger on the last closed H4 bar, entry next open, stop %s", n.dir > 0 ? "LONG" : "SHORT", DoubleToString(n.sl, (int)SymbolInfoInteger(n.sym, SYMBOL_DIGITS)))); }
         else if(InpAlertTurn && !n.live && n.trendW != 0 && n.stage == 3 && prevStage != 3 && n.alertBar != n.h4bar) { gRow[k].alertBar = n.h4bar; Notify(n, StringFormat("weekly %s, H4 turn formed: a close %s %s triggers", n.trendW > 0 ? "UP" : "DOWN", n.dir > 0 ? "above" : "below", DoubleToString(n.B, (int)SymbolInfoInteger(n.sym, SYMBOL_DIGITS)))); }
         gRow[k].lastStage = n.stage;
        }
      return;       // one symbol per call keeps every call short
     }
  }

int ParseSymbols()
  {
   string parts[]; int m = StringSplit(InpSymbols, ',', parts);
   int n = 0;
   for(int i = 0; i < m && n < MAXSYM; i++)
     {
      string s = parts[i]; StringTrimLeft(s); StringTrimRight(s);
      if(s == "") continue;
      gRow[n].sym = s + InpSuffix; gRow[n].state = 0; gRow[n].fails = 0; gRow[n].tryMs = 0; gRow[n].alertBar = 0; gRow[n].lastStage = -1; gRow[n].h4bar = 0; gRow[n].live = false; gRow[n].pending = false; gRow[n].trendW = 0; gRow[n].stage = 0; gRow[n].n3 = 0;
      n++;
     }
   return n;
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Position Scanner");
   if(InpSwingW < 1 || InpSwingW > 5 || InpSwingH < 1 || InpSwingH > 8 || InpMinSwingAtr < 0.0 || InpMinSwingAtr > 5.0 || InpMinRetrace < 0.1 || InpMinRetrace > 0.9 || InpStopBufAtr < 0.0 || InpStopBufAtr > 3.0 ||
      InpRR1 < 0.5 || InpRR1 > 18.0 || InpTimeStopWeeks < 1 || InpTimeStopWeeks > 52 || InpH4Bars < 1000 || InpH4Bars > 12000 || InpWeeklyBars < 100 || InpWeeklyBars > 1000)
     {
      Print("AT24 Position Scanner: swing bars W 1-5, H4 1-8; min swing 0-5 ATR; retrace 0.1-0.9; stop buffer 0-3 ATR; target 0.5-18; time stop 1-52 weeks; H4 bars 1000-12000; weekly bars 100-1000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   gN = ParseSymbols();
   if(gN == 0) { Print("AT24 Position Scanner: no symbols."); return INIT_PARAMETERS_INCORRECT; }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   EventSetTimer(1);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer() { Step(); Draw(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 1) return 0;
   int trig = 0;
   for(int i = 0; i < gN; i++) if(Priority(gRow[i]) == 0) trig++;
   B0[0] = trig;
   return rates_total;
  }
