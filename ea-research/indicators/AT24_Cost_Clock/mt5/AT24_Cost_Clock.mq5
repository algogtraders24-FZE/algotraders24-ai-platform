//+------------------------------------------------------------------+
//| AT24 Cost Clock (MT5)                                            |
//| What does a round trip cost RIGHT NOW compared with how far      |
//| price usually moves in this New York hour? Spread as a share of |
//| the typical hourly range, for all 24 hours, with the current     |
//| hour marked. Cost context only. Not a signal.                    |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Cost Clock - spread as a share of the typical hourly range for each New York hour; shows which hours are cheap or costly to trade."
#property description "Descriptive history on your broker's data. It places no trades. Not a signal."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   0

#include "AT24_ServerClock.mqh"
#include "AT24_CC_Core.mqh"

#resource "cc_logo56.bmp"

input group "=== Window ==="
input int    InpDays          = 365;    // Calendar days of history (bars with an empty spread field are skipped)
input group "=== Clock ==="
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (needed for the New York hour)
input int    InpManualBase    = -99;    // Broker clock: winter offset from GMT in hours (-99 = detect automatically)
input ENUM_AT24SC_RULE InpManualRule = AT24SC_US; // Broker clock: daylight rule when set manually (1 none, 2 US, 3 EU)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[];
string PFX = "AT24CC_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0, gNow = 0, gOk = 0;
AT24CC_Hour gO[];
datetime gBuiltAt = 0;
AT24SC_Clock gClk;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

#define DASH_W 380
#define DASH_H 262

void RefreshClock()
  {
   if(!InpDstAware) { gClk.ok = false; return; }
   if(InpManualBase != -99) { if(!gClk.ok || gClkAt == 0) { AT24SC_SetManual(gClk, InpManualBase, (int)InpManualRule); gClkAt = TimeCurrent(); } return; }
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_DetectAny(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
  }

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - DASH_W - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - DASH_H - InpDashY) : InpDashY;
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

void MakeRect(const string name, const int x, const int y, const int w, const int h, const color bg, const color border)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

void BuildFrame()
  {
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40', C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::cc_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string HourList(const bool cheap, const int count)
  {
   string s = "";
   for(int k = 1; k <= 24 && count > 0; k++)
     {
      int want = cheap ? k : gOk + 1 - k;
      if(want < 1 || want > gOk) continue;
      for(int h = 0; h < 24; h++) if(gO[h].rank == want) { s += (s == "" ? "" : ", ") + StringFormat("%02d", h); break; }
      if(StringLen(s) >= count * 4 - 2) break;
     }
   return s;
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 COST CLOCK", C'230,190,80', 10, true);
   if(gBars < 500 || !gClk.ok || gOk < 8)
     {
      MakeLabel("t2", 70, 26, gBars >= 500 && gOk < 8 ? "SPREAD FIELD EMPTY IN THIS HISTORY" : "LOADING HOURLY HISTORY", clrSlateGray, 11, true);
      if(gBars >= 500 && gOk < 8) MakeLabel("t3", 70, 42, "(run AT24 History Doctor)", clrSilver, 8);
      return;
     }
   AT24CC_Hour c = gO[gNow];
   string verdict = "no data for this hour"; color vc = clrSlateGray;
   if(c.rank > 0)
     {
      int third = (int)MathCeil(gOk / 3.0);
      if(c.rank <= third) { verdict = "CHEAP HOUR"; vc = clrLimeGreen; }
      else if(c.rank > gOk - third) { verdict = "COSTLY HOUR"; vc = clrTomato; }
      else { verdict = "AVERAGE COST"; vc = clrGold; }
     }
   MakeLabel("t2", 70, 26, StringFormat("NY %02d:00  %s", gNow, verdict), vc, 11, true);
   if(c.rank > 0) MakeLabel("t3", 70, 42, StringFormat("spread %.2f = %.1f %% of the typical hour range (rank %d of %d)", c.medSpread, 100.0 * c.medRatio, c.rank, gOk), clrWhite, 8);
   else MakeLabel("t3", 70, 42, " ", clrWhite, 8);
   //--- 24-hour strip: bar height proportional to cost/range, colour by third, current hour outlined
   double mx = 0.0; for(int h = 0; h < 24; h++) if(gO[h].rank > 0) mx = MathMax(mx, gO[h].medRatio);
   int third = (int)MathCeil(gOk / 3.0), base = 150, maxH = 60;
   for(int h = 0; h < 24; h++)
     {
      string nm = "bar" + IntegerToString(h);
      int x = 12 + h * 14;
      if(gO[h].rank == 0) { MakeRect(nm, x, base - 2, 12, 2, C'60,70,90', C'60,70,90'); continue; }
      int bh = MathMax(3, (int)MathRound(maxH * gO[h].medRatio / mx));
      color col = gO[h].rank <= third ? C'60,190,110' : (gO[h].rank > gOk - third ? C'220,90,80' : C'210,170,60');
      MakeRect(nm, x, base - bh, 12, bh, col, h == gNow ? clrWhite : col);
     }
   for(int k = 0; k < 4; k++) MakeLabel("ax" + IntegerToString(k), 12 + k * 6 * 14, base + 3, StringFormat("%02d", k * 6), clrSlateGray, 7);
   MakeLabel("axn", 12 + 18 * 14 + 30, base + 3, "New York hour", clrSlateGray, 7);
   MakeLabel("l1", 10, 172, "Cheapest: " + HourList(true, 5), clrLimeGreen, 8, true);
   MakeLabel("l2", 10, 187, "Costliest: " + HourList(false, 4), clrTomato, 8, true);
   MakeLabel("n1", 10, 206, "Cost = spread / median range of that hour (bar-level spread).", clrSlateGray, 8);
   MakeLabel("n2", 10, 220, "A cheap hour is not a good trade; it only costs less per move.", clrSlateGray, 8);
   MakeLabel("f1", 10, 240, StringFormat("Last %d days on your broker's data. Not a signal.", InpDays), clrSlateGray, 7);
   MakeLabel("f2", 10, 251, "No trades are placed. algotraders24.ai", clrSlateGray, 7);
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, PERIOD_H1, 1, 40000, rr);
   if(n < 500) { gBars = MathMax(n, 0); return false; }
   datetime t[]; double h[], l[]; int sp[], hr[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(sp, n); ArrayResize(hr, n);
   for(int i = 0; i < n; i++)
     {
      t[i] = rr[i].time; h[i] = rr[i].high; l[i] = rr[i].low; sp[i] = (int)rr[i].spread;
      datetime g = AT24SC_ToGmt(gClk, rr[i].time);
      hr[i] = (int)(((long)(g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600)) % 86400) / 3600);
     }
   AT24CC_Analyze(n, t, h, l, sp, hr, InpDays, SymbolInfoDouble(_Symbol, SYMBOL_POINT), 20, gO);
   gOk = 0; for(int k = 0; k < 24; k++) if(gO[k].rank > 0) gOk++;
   gBars = n;
   B0[0] = gOk;
   return true;
  }

void Refresh()
  {
   RefreshClock();
   datetime hourNow = (datetime)(((long)TimeCurrent() / 3600) * 3600);
   if(gBuiltAt != hourNow && gClk.ok) { if(Rebuild()) gBuiltAt = hourNow; }
   if(gClk.ok)
     {
      datetime g = AT24SC_ToGmt(gClk, TimeCurrent());
      gNow = (int)(((long)(g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600)) % 86400) / 3600);
      B1[0] = gNow; if(gO[gNow].rank > 0) B2[0] = gO[gNow].medRatio;
     }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Cost Clock");
   if(InpDays < 60 || InpDays > 1500 || !InpDstAware)
     {
      Print("AT24 Cost Clock: history window 60-1500 days, DST-aware clock on (needed for the New York hour).");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gO, 24);
   for(int h = 0; h < 24; h++) { gO[h].hour = h; gO[h].n = 0; gO[h].medSpread = 0; gO[h].medRange = 0; gO[h].medRatio = 0; gO[h].rank = 0; }
   EventSetTimer(5);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer() { Refresh(); Draw(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 10) return 0;
   Refresh();
   Draw();
   return rates_total;
  }
