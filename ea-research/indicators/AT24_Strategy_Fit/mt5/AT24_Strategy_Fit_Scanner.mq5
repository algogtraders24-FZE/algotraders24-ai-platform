//+------------------------------------------------------------------+
//| AT24 Strategy Fit Scanner (MT5)                                  |
//| One table for many symbols: which rule (trend, breakout,         |
//| reversion) signals right now on the last closed H1 bar, in which |
//| AT24 Regime AI market state, and how that rule performed in that |
//| state on the symbol's own history (average R, n, luck test).     |
//| Same engine as AT24 Strategy Fit and AT24 Regime AI. Closed bars|
//| only. A measurement of the past, not a forecast. No trades.      |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.10"
#property description "AT24 Strategy Fit Scanner - the rule signals of the last closed H1 bar for a list of symbols, with each rule's own record in the current market state (average R, n, luck test), the typical next 24 h range and the ATR."
#property description "A measurement of the past, not a forecast. Places no trades. Past results do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots   0

#include "AT24_SF_Core.mqh"
#include "AT24_RA_Range.mqh"

#resource "sf_logo56.bmp"

input group "=== Symbols ==="
input string InpSymbols    = "EURUSD,GBPUSD,USDJPY,USDCHF,AUDUSD,NZDUSD,USDCAD,EURJPY,GBPJPY,XAUUSD,XAGUSD,US30,US500,USTEC,BTCUSD"; // Symbols (comma separated, up to 24)
input string InpSuffix     = "";     // Broker suffix added to every symbol (for example .m or _x)
input group "=== History ==="
input int    InpHistBars   = 20000;  // Closed H1 bars used per symbol
input double InpStopAtr    = 2.0;    // Protective stop of the measured trades, in ATR(14) of the signal bar (0 = no stop)
input group "=== Table ==="
input int    InpRows       = 12;     // Signal rows shown
input bool   InpOnlyFit    = false;  // Show only signals whose own record is FIT
input group "=== Alert (bar close) ==="
input bool   InpAlert      = false;  // Alert when a rule signals in a state where its own record is FIT
input bool   InpAlertPush  = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash   = true;   // Show dashboard
input bool   InpDashInTester = false;// Show dashboard in Strategy Tester
input bool   InpDebugLog   = false;  // Print each symbol rebuild to the Experts log
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX      = 10;     // Dashboard X offset
input int    InpDashY      = 20;     // Dashboard Y offset

#define MAXSYM 24
#define DASH_W 760

struct SfRow
  {
   string   sym;
   int      state;          // 0 not built, 1 ok, 2 loading history, 3 no data / symbol missing
   int      fails;
   int      mstate;         // market state (Regime AI) of the last closed bar
   int      sig[AT24SF_NR];
   int      cls[AT24SF_NR];
   double   avg[AT24SF_NR];
   int      n[AT24SF_NR];
   double   p[AT24SF_NR];
   double   rmid, rlo, rhi, atr;
   bool     rOk;
   int      digits;
   datetime h1bar;
   uint     tryMs;
   datetime alertBar[AT24SF_NR];
   uint     ms;
  };

struct Cand { int row; int rule; double key; };

double B0[];
string PFX = "AT24SFS_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
SfRow  gRow[MAXSYM];
int    gN = 0;
int    gRows = 12;

int DashH() { return 112 + 22 * gRows + 58; }

color StateColor(const int s)
  {
   switch(s)
     {
      case 0: return C'120,130,145';
      case 1: return C'230,140,60';
      case 2: return C'60,190,110';
      case 3: return C'80,160,230';
      case 4: return C'180,120,220';
     }
   return clrSlateGray;
  }

color Mix(const color a, const color b, const double t)
  {
   int ar = a & 0xFF, ag = (a >> 8) & 0xFF, ab = (a >> 16) & 0xFF;
   int br = b & 0xFF, bgc = (b >> 8) & 0xFF, bb = (b >> 16) & 0xFF;
   int r = (int)(ar + (br - ar) * t), g = (int)(ag + (bgc - ag) * t), u = (int)(ab + (bb - ab) * t);
   return (color)(r | (g << 8) | (u << 16));
  }

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - DASH_W - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - DashH() - InpDashY) : InpDashY;
  }

void MakeLabel(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false, const string font = "")
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetString(0, n, OBJPROP_FONT, font != "" ? font : (bold ? "Segoe UI Black" : "Segoe UI"));
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, n, OBJPROP_TEXT, txt == "" ? " " : txt);
  }

void Rect(const string name, const int x, const int y, const int w, const int h, const color bg, const ENUM_BORDER_TYPE bt, const color border)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, MathMax(h, 1));
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, bt);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

void BuildFrame()
  {
   CalcBase();
   int H = DashH();
   Rect("shadow", 6, 6, DASH_W, H, C'2,4,10', BORDER_FLAT, C'2,4,10');
   Rect("bg", 0, 0, DASH_W, H, C'14,26,48', BORDER_RAISED, C'110,130,175');
   Rect("hd", 4, 4, DASH_W - 8, 62, C'26,50,96', BORDER_RAISED, C'120,150,210');
   Rect("hd2", 4, 4, DASH_W - 8, 8, C'44,78,140', BORDER_FLAT, C'44,78,140');
   Rect("tb", 10, 74, DASH_W - 20, 24 + 22 * gRows + 8, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   for(int k = 0; k < gRows; k++) Rect("rw" + IntegerToString(k), 14, 100 + k * 22, DASH_W - 28, 20, C'14,22,38', BORDER_FLAT, C'14,22,38');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sf_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 8);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 7);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

//--- rebuild one symbol with the same chain as the Strategy Fit indicator and the Regime AI range model
void BuildRow(SfRow &r)
  {
   uint t0 = GetTickCount();
   if(!SymbolSelect(r.sym, true)) { r.state = 3; r.tryMs = GetTickCount() + 300000; return; }
   MqlRates rr[];
   int n = CopyRates(r.sym, PERIOD_H1, 1, MathMax(InpHistBars, 4000), rr);
   if(n < 3000)
     {
      r.fails++;
      r.state = (r.fails >= 4 && n <= 0) ? 3 : 2;
      r.tryMs = GetTickCount() + (r.state == 3 ? 300000 : 8000);
      return;
     }
   r.fails = 0;
   double o[], h[], l[], c[]; datetime t[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(t, n);
   for(int i = 0; i < n; i++) { t[i] = rr[i].time; o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; c[i] = rr[i].close; }
   double atr[], er[], lv[], sl[], rg[]; bool ok[]; int st[], sig[];
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(n, er, lv, sl, rg, ok, st);
   AT24SF_Signals(n, h, l, c, sig);
   double cost = MathMax(0.0, SymbolInfoDouble(r.sym, SYMBOL_ASK) - SymbolInfoDouble(r.sym, SYMBOL_BID));
   int from = MathMax(AT24SF_FIRST, n - InpHistBars);
   AT24SF_Res res; AT24SF_Run(n, o, h, l, atr, ok, st, sig, cost, InpStopAtr, from, res);
   r.mstate = st[n - 1];
   for(int q = 0; q < AT24SF_NR; q++)
     {
      r.sig[q] = sig[(n - 1) * AT24SF_NR + q];
      if(r.mstate >= 0)
        {
         AT24SF_Cell cc = res.c[q * AT24RA_K + r.mstate];
         r.cls[q] = cc.cls; r.avg[q] = cc.avg; r.n[q] = cc.n; r.p[q] = cc.p;
        }
      else { r.cls[q] = 2; r.avg[q] = 0.0; r.n[q] = 0; r.p[q] = 1.0; }
     }
   AT24RR_Out ro; AT24RR_Run(n, from, t, h, l, c, ro);
   r.rOk = ro.ok; r.rmid = ro.mid; r.rlo = ro.lo; r.rhi = ro.hi; r.atr = atr[n - 1];
   r.digits = (int)SymbolInfoInteger(r.sym, SYMBOL_DIGITS);
   r.state = 1;
   r.h1bar = iTime(r.sym, PERIOD_H1, 0);
   r.ms = GetTickCount() - t0;
   if(InpDebugLog) PrintFormat("AT24SFS %s state=%d sig=%d/%d/%d cls=%d/%d/%d avg=%+.3f/%+.3f/%+.3f n=%d/%d/%d range=%.5f atr=%.5f ms=%u", r.sym, r.mstate, r.sig[0], r.sig[1], r.sig[2], r.cls[0], r.cls[1], r.cls[2], r.avg[0], r.avg[1], r.avg[2], r.n[0], r.n[1], r.n[2], r.rmid, r.atr, r.ms);
  }

double Key(const SfRow &r, const int q)
  {
   int cl = r.cls[q];
   double grp = (cl == 1) ? 0.0 : (cl == 0 ? 1.0 : (cl == 2 ? 2.0 : 3.0));
   return grp * 1000.0 - r.avg[q];
  }

string ClsTxt(const int cls)
  {
   if(cls == 1) return "FIT";
   if(cls == -1) return "AVOID";
   if(cls == 0) return "NEUTRAL";
   return "TOO FEW";
  }
color ClsCol(const int cls)
  {
   if(cls == 1) return clrLimeGreen;
   if(cls == -1) return clrTomato;
   if(cls == 0) return clrSilver;
   return clrSlateGray;
  }
color ClsBg(const int cls)
  {
   if(cls == 1) return C'24,78,46';
   if(cls == -1) return C'84,34,34';
   if(cls == 0) return C'30,40,62';
   return C'18,26,42';
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 72, 10, "AT24 STRATEGY FIT SCANNER", C'255,214,110', 14, true);
   MakeLabel("t2", 72, 38, "which rule signals now, and how it did in this state", C'170,190,225', 9);
   int ok = 0, fit = 0, tot = 0;
   Cand cd[]; int nc = 0; ArrayResize(cd, MAXSYM * AT24SF_NR);
   for(int i = 0; i < gN; i++)
     {
      if(gRow[i].state != 1) continue;
      ok++;
      for(int q = 0; q < AT24SF_NR; q++)
        {
         if(gRow[i].sig[q] == 0) continue;
         tot++; if(gRow[i].cls[q] == 1) fit++;
         if(InpOnlyFit && gRow[i].cls[q] != 1) continue;
         cd[nc].row = i; cd[nc].rule = q; cd[nc].key = Key(gRow[i], q); nc++;
        }
     }
   for(int a = 1; a < nc; a++) { Cand x = cd[a]; int j = a - 1; while(j >= 0 && cd[j].key > x.key) { cd[j + 1] = cd[j]; j--; } cd[j + 1] = x; }
   MakeLabel("t3", 440, 10, "SYMBOLS READ", C'255,214,110', 8, true);
   MakeLabel("t4", 440, 24, StringFormat("%d of %d   FIT %d   all signals %d", ok, gN, fit, tot), clrWhite, 10, true);
   int y = 78;
   MakeLabel("h0", 18, y, "SYMBOL", C'255,214,110', 8, true);
   MakeLabel("h1", 100, y, "MARKET STATE", C'255,214,110', 8, true);
   MakeLabel("h2", 232, y, "RULE", C'255,214,110', 8, true);
   MakeLabel("h3", 318, y, "SIGNAL", C'255,214,110', 8, true);
   MakeLabel("h4", 408, y, "OWN RECORD IN THIS STATE", C'255,214,110', 8, true);
   MakeLabel("h5", 574, y, "NEXT 24 H RANGE", C'255,214,110', 8, true);
   MakeLabel("h6", 696, y, "1 ATR", C'255,214,110', 8, true);
   for(int k = 0; k < gRows; k++)
     {
      int yy = 102 + k * 22; string id = IntegerToString(k);
      if(k < nc)
        {
         SfRow r = gRow[cd[k].row]; int q = cd[k].rule; int dg = r.digits;
         Rect("rw" + id, 14, 100 + k * 22, DASH_W - 28, 20, ClsBg(r.cls[q]), BORDER_RAISED, Mix(ClsBg(r.cls[q]), clrWhite, 0.25));
         MakeLabel("a0" + id, 20, yy, r.sym, clrWhite, 9, true);
         MakeLabel("a1" + id, 100, yy, r.mstate >= 0 ? AT24RA_Name(r.mstate) : "-", StateColor(r.mstate), 8, true);
         MakeLabel("a2" + id, 232, yy, AT24SF_RuleName(q), clrSilver, 8, true);
         MakeLabel("a3" + id, 318, yy - 1, r.sig[q] > 0 ? ShortToString(0x25B2) + " LONG" : ShortToString(0x25BC) + " SHORT", r.sig[q] > 0 ? clrLimeGreen : clrTomato, 10, true, "Segoe UI Symbol");
         MakeLabel("a4" + id, 408, yy, StringFormat("%s  %+.2f R  n %d  p %.2f", ClsTxt(r.cls[q]), r.avg[q], r.n[q], r.p[q]), ClsCol(r.cls[q]), 8, r.cls[q] == 1);
         MakeLabel("a5" + id, 574, yy, r.rOk ? StringFormat("%s - %s", DoubleToString(r.rlo, dg), DoubleToString(r.rhi, dg)) : "-", clrSilver, 8);
         MakeLabel("a6" + id, 696, yy, DoubleToString(r.atr, dg), clrSilver, 8);
        }
      else
        {
         Rect("rw" + id, 14, 100 + k * 22, DASH_W - 28, 20, C'14,22,38', BORDER_FLAT, C'14,22,38');
         for(int c2 = 0; c2 < 7; c2++) MakeLabel("a" + IntegerToString(c2) + id, 20, yy, " ", clrSlateGray, 8);
         if(k == 0 && nc == 0) MakeLabel("a0" + id, 20, yy, ok == 0 ? "reading symbols ..." : "no rule signals on the last closed H1 bar", clrSlateGray, 8);
        }
     }
   int fy = 112 + 22 * gRows;
   MakeLabel("n1", 12, fy, "Record: same rule, same state, this symbol's own history:", clrSlateGray, 7);
   MakeLabel("n2", 12, fy + 11, (InpStopAtr > 0.0 ? StringFormat("next-open entry, 24 h hold, stop %.1f ATR, spread cost.", InpStopAtr) : "next-open entry, 24 h hold, NO stop, spread cost."), clrSlateGray, 7);
   MakeLabel("n3", 12, fy + 22, "FIT = average above 0, p below 0.10, n 30+. FIT first.", clrSlateGray, 7);
   MakeLabel("n4", 12, fy + 33, "A measurement of the past, not a forecast. algotraders24.ai", clrSlateGray, 7);
   ChartRedraw(0);
  }

void Notify(const SfRow &r, const int q)
  {
   string msg = StringFormat("AT24 Strategy Fit Scanner %s: %s %s in %s (own record FIT %+.2f R, n %d)", r.sym, AT24SF_RuleName(q), r.sig[q] > 0 ? "long" : "short", AT24RA_Name(r.mstate), r.avg[q], r.n[q]);
   Alert(msg);
   if(InpAlertPush) SendNotification(msg);
  }

//--- one symbol per timer tick: never built, a new H1 bar, or the retry time has come
void Step()
  {
   for(int k = 0; k < gN; k++)
     {
      bool due = false;
      if(gRow[k].state == 0) due = true;
      else if(gRow[k].state == 1) due = (iTime(gRow[k].sym, PERIOD_H1, 0) != gRow[k].h1bar && iTime(gRow[k].sym, PERIOD_H1, 0) > 0);
      else due = ((int)(GetTickCount() - gRow[k].tryMs) >= 0);
      if(!due) continue;
      BuildRow(gRow[k]);
      if(gRow[k].state == 1 && InpAlert)
         for(int q = 0; q < AT24SF_NR; q++)
            if(gRow[k].sig[q] != 0 && gRow[k].cls[q] == 1 && gRow[k].alertBar[q] != gRow[k].h1bar) { gRow[k].alertBar[q] = gRow[k].h1bar; Notify(gRow[k], q); }
      return;
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
      gRow[n].sym = s + InpSuffix; gRow[n].state = 0; gRow[n].fails = 0; gRow[n].tryMs = 0; gRow[n].h1bar = 0; gRow[n].mstate = -1; gRow[n].rOk = false; gRow[n].digits = 5;
      for(int q = 0; q < AT24SF_NR; q++) { gRow[n].sig[q] = 0; gRow[n].cls[q] = 2; gRow[n].avg[q] = 0.0; gRow[n].n[q] = 0; gRow[n].p[q] = 1.0; gRow[n].alertBar[q] = 0; }
      n++;
     }
   return n;
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Strategy Fit Scanner");
   if(InpHistBars < 4000 || InpHistBars > 100000 || InpRows < 3 || InpRows > 24 || InpStopAtr < 0.0 || (InpStopAtr > 0.0 && InpStopAtr < 0.5) || InpStopAtr > 10.0)
     {
      Print("AT24 Strategy Fit Scanner: history bars 4000-100000, rows 3-24, stop 0 or 0.5-10 ATR.");
      return INIT_PARAMETERS_INCORRECT;
     }
   gRows = InpRows;
   gN = ParseSymbols();
   if(gN == 0) { Print("AT24 Strategy Fit Scanner: no symbols."); return INIT_PARAMETERS_INCORRECT; }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   EventSetTimer(1);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) Draw();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer() { Step(); Draw(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 1) return 0;
   int fit = 0;
   for(int i = 0; i < gN; i++)
      if(gRow[i].state == 1) for(int q = 0; q < AT24SF_NR; q++) if(gRow[i].sig[q] != 0 && gRow[i].cls[q] == 1) fit++;
   B0[0] = fit;
   return rates_total;
  }
