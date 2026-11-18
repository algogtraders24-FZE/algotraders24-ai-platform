//+------------------------------------------------------------------+
//| AT24 Regime AI (MT5)                                             |
//| Every closed H1 bar is put into one of 5 learned market states   |
//| (k-means, fixed constants, no repaint). The dashboard shows the  |
//| state, how long it has lasted and what each state of THIS symbol |
//| was followed by: the size of the next 24 hours, with n.          |
//| It says how big moves tend to be, not which way. No signals.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Regime AI - 5 learned market states on H1 (nearest of 5 fixed k-means centroids), run length, persistence and what each state of this symbol was followed by (next 24 h range, with n)."
#property description "Size of moves, not direction. Places no trades. Past statistics do not predict future results. Not financial advice."
#property indicator_separate_window
#property indicator_buffers 5
#property indicator_plots   1
#property indicator_minimum 0
#property indicator_maximum 1
#property indicator_type1   DRAW_COLOR_HISTOGRAM
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2
#property indicator_color1  C'120,130,145',C'230,140,60',C'60,190,110',C'80,160,230',C'180,120,220'
#property indicator_label1  "AT24 state"

#include "AT24_RA_Core.mqh"

#resource "ra_logo56.bmp"

input group "=== History ==="
input int    InpHistBars   = 20000;   // Closed bars used for the own-history statistics
input int    InpMaxBars    = 30000;   // Bars read from the chart (limits the first calculation)
input group "=== Alert (bar close) ==="
input bool   InpAlertChange = false;  // Alert when the state changes on a closed bar
input bool   InpAlertPush   = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash    = true;   // Show dashboard
input bool   InpDashInTester = false; // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX       = 10;     // Dashboard X offset
input int    InpDashY       = 20;     // Dashboard Y offset

double B_hist[], B_col[], B_state[], B_run[], B_ratio[];
string PFX = "AT24RA_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
datetime gLastBar = 0;
int    gLastState = -2;
AT24RA_Stat gStat;
int    gStateNow = -1, gRunNow = 0;
bool   gHaveStat = false;
int    gWin = 0;      // the dashboard lives in the main chart window

#define DASH_W 470
#define DASH_H 282

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

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, gWin);
   gBaseX = right ? MathMax(0, w - DASH_W - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - DASH_H - InpDashY) : InpDashY;
  }

void MakeLabel(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, gWin, 0, 0);
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
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, gWin, 0, 0);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, DASH_W);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, DASH_H);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, gWin, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ra_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string RatioTxt(const AT24RA_Stat &s, const int k)
  {
   if(s.ratio[k] <= 0.0) return StringFormat("-  (n %d)", s.nf[k]);
   return StringFormat("x%.2f  (n %d)", s.ratio[k], s.nf[k]);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 REGIME AI", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, "learned market state, H1 closed bars", clrSlateGray, 8);
   if(_Period != PERIOD_H1)
     {
      MakeLabel("w1", 10, 80, "Trained on H1. Open this on an H1 chart.", clrGold, 9, true);
      return;
     }
   if(!gHaveStat || gStateNow < 0)
     {
      MakeLabel("w1", 10, 80, "Not enough history (needs 200+ bars).", clrGold, 9, true);
      return;
     }
   ObjectDelete(0, PFX + "w1");
   int k = gStateNow;
   MakeLabel("c1", 10, 70, "NOW", C'230,190,80', 8, true);
   MakeLabel("c2", 50, 66, AT24RA_Name(k), StateColor(k), 12, true);
   MakeLabel("c3", 10, 90, StringFormat("for %d bar%s    stays next bar %.0f %%    mean run %.1f bars", gRunNow, gRunNow == 1 ? "" : "s", gStat.pStay[k] * 100.0, gStat.meanRun[k]), clrSilver, 8);
   MakeLabel("c4", 10, 106, StringFormat("next 24 h range on this symbol: %s", RatioTxt(gStat, k)), clrSilver, 8);
   MakeLabel("h0", 10, 132, "STATE", C'230,190,80', 8, true);
   MakeLabel("h1", 130, 132, "SHARE", C'230,190,80', 8, true);
   MakeLabel("h2", 190, 132, "MEAN RUN", C'230,190,80', 8, true);
   MakeLabel("h3", 265, 132, "STAYS", C'230,190,80', 8, true);
   MakeLabel("h4", 325, 132, "NEXT 24 H RANGE", C'230,190,80', 8, true);
   for(int q = 0; q < AT24RA_K; q++)
     {
      int y = 150 + q * 16;
      string id = IntegerToString(q);
      MakeLabel("s0" + id, 10, y, (q == k ? "> " : "  ") + AT24RA_Name(q), StateColor(q), 8, q == k);
      MakeLabel("s1" + id, 130, y, StringFormat("%.0f %%", gStat.share[q] * 100.0), clrSilver, 8);
      MakeLabel("s2" + id, 190, y, StringFormat("%.1f", gStat.meanRun[q]), clrSilver, 8);
      MakeLabel("s3" + id, 265, y, StringFormat("%.0f %%", gStat.pStay[q] * 100.0), clrSilver, 8);
      MakeLabel("s4" + id, 325, y, RatioTxt(gStat, q), gStat.ratio[q] <= 0.0 ? clrSlateGray : (gStat.ratio[q] > 1.05 ? C'230,140,60' : (gStat.ratio[q] < 0.95 ? C'80,160,230' : clrSilver)), 8);
     }
   MakeLabel("n1", 10, 238, "x1.00 = average next 24 h range of this symbol.", clrSlateGray, 8);
   MakeLabel("n2", 10, 251, "Size of moves, not direction. n = bars counted.", clrSlateGray, 8);
   MakeLabel("f1", 10, 266, "Planning tool, not a signal. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B_hist, INDICATOR_DATA);
   SetIndexBuffer(1, B_col, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, B_state, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B_run, INDICATOR_CALCULATIONS);
   SetIndexBuffer(4, B_ratio, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B_hist, false); ArraySetAsSeries(B_col, false); ArraySetAsSeries(B_state, false); ArraySetAsSeries(B_run, false); ArraySetAsSeries(B_ratio, false);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Regime AI");
   IndicatorSetInteger(INDICATOR_DIGITS, 2);
   if(InpHistBars < 2000 || InpHistBars > 200000 || InpMaxBars < 3000 || InpMaxBars > 200000)
     {
      Print("AT24 Regime AI: history bars 2000-200000, bars read 3000-200000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { ObjectsDeleteAll(0, PFX); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 500) return 0;
   //--- only closed bars: the forming bar (last index) is excluded; recalc once per new bar
   datetime curBar = time[rates_total - 1];
   if(prev_calculated > 0 && curBar == gLastBar) return rates_total;
   gLastBar = curBar;
   int nUse = MathMin(rates_total - 1, InpMaxBars);          // closed bars to use
   int off = (rates_total - 1) - nUse;                        // first used index in the chart arrays
   double h[], l[], c[]; ArrayResize(h, nUse); ArrayResize(l, nUse); ArrayResize(c, nUse);
   for(int i = 0; i < nUse; i++) { h[i] = high[off + i]; l[i] = low[off + i]; c[i] = close[off + i]; }
   double atr[], er[], lv[], sl[], rg[], fr[]; bool ok[]; int st[];
   AT24RA_Features(nUse, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(nUse, er, lv, sl, rg, ok, st);
   AT24RA_Forward(nUse, h, l, atr, ok, fr);
   int from = MathMax(AT24RA_FIRST, nUse - InpHistBars);
   AT24RA_Stats(nUse, from, st, fr, gStat);
   //--- buffers: chart arrays; the forming bar and bars before the first valid state are empty
   for(int i = 0; i < rates_total; i++)
     {
      B_hist[i] = EMPTY_VALUE; B_col[i] = 0; B_state[i] = EMPTY_VALUE; B_run[i] = EMPTY_VALUE; B_ratio[i] = EMPTY_VALUE;
     }
   int run = 0;
   for(int i = 0; i < nUse; i++)
     {
      int k = st[i]; int ci = off + i;
      if(k < 0) { run = 0; continue; }
      run = (i > 0 && st[i - 1] == k) ? run + 1 : 1;
      B_hist[ci] = 1.0; B_col[ci] = k; B_state[ci] = k; B_run[ci] = run; B_ratio[ci] = gStat.ratio[k];
     }
   gStateNow = st[nUse - 1];
   gRunNow = AT24RA_RunLen(st, nUse - 1);
   gHaveStat = (gStat.nAll > 0);
   if(InpAlertChange && gLastState != -2 && gStateNow >= 0 && gStateNow != gLastState && gLastState >= 0)
     {
      string msg = StringFormat("AT24 Regime AI %s: %s -> %s", _Symbol, AT24RA_Name(gLastState), AT24RA_Name(gStateNow));
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
   gLastState = gStateNow;
   Draw();
   return rates_total;
  }
