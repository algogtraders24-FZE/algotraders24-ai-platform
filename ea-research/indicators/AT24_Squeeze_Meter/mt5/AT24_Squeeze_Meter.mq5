//+------------------------------------------------------------------+
//| AT24 Squeeze Meter (MT5)                                         |
//| Bollinger-inside-Keltner squeeze, momentum - and what price      |
//| really did after squeezes released on YOUR symbol.               |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Squeeze Meter - squeeze state, momentum and real post-squeeze statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_separate_window
#property indicator_buffers 6
#property indicator_plots   2

#property indicator_label1  "Momentum"
#property indicator_type1   DRAW_COLOR_HISTOGRAM
#property indicator_color1  clrLimeGreen,clrForestGreen,clrTomato,clrFireBrick
#property indicator_width1  3

#property indicator_label2  "Squeeze (red = on)"
#property indicator_type2   DRAW_COLOR_ARROW
#property indicator_color2  clrDimGray,clrRed
#property indicator_width2  2

#include "AT24_Squeeze_Core.mqh"

#resource "sq_logo56.bmp"

input group "=== Squeeze ==="
input int    InpBBLen         = 20;     // Bollinger length
input double InpBBMult        = 2.0;    // Bollinger deviations
input int    InpKCLen         = 20;     // Keltner length
input double InpKCMult        = 1.5;    // Keltner ATR multiple
input int    InpAtr           = 14;     // ATR length
input group "=== Statistics ==="
input int    InpMinBars       = 6;      // Squeeze must last at least this many bars to count
input int    InpWindow        = 20;     // Bars after the release that are measured
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertRelease  = false;  // Alert when a squeeze releases
input bool   InpAlertPush     = false;  // Also send push notification

double BufMom[], BufMomC[], BufDot[], BufDotC[], BufSq[], BufRatio[];
string PFX = "AT24SQ_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
double gStats[];
AT24SQ_Ev gEv[];
int    gNEv = 0, gRunNow = 0, gSinceRelease = -1, gMomNow = 0;
double gRatioNow = 0.0;
datetime gAlertBar = 0;

#define DASH_W 350
#define DASH_H 250

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
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
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
   ObjectSetInteger(0, n, OBJPROP_YSIZE, DASH_H);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sq_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   string state; color sc;
   if(gRunNow > 0) { state = StringFormat("SQUEEZE ON  (%d bars)", gRunNow); sc = clrTomato; }
   else if(gSinceRelease >= 0 && gSinceRelease <= 5) { state = StringFormat("RELEASED %d bar(s) ago", gSinceRelease); sc = clrGold; }
   else { state = "NO SQUEEZE"; sc = clrSlateGray; }
   MakeLabel("t1", 70, 6, "AT24 SQUEEZE METER", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, state, sc, 11, true);
   MakeLabel("l1", 10, 66, StringFormat("Momentum  %s     Band ratio (BB/KC)  %.2f", gMomNow > 0 ? "UP" : (gMomNow < 0 ? "DOWN" : "-"), gRatioNow), clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("Median squeeze length  %.0f bars   (this one: %d)", gStats[6], gRunNow), clrWhite, 9);
   MakeLabel("h1", 10, 108, StringFormat("Last %d bars: %d squeezes >= %d bars  (%d measured)", InpHistoryBars, (int)gStats[7], InpMinBars, (int)gStats[0]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("Next %d bars range: median %.1f ATR vs %.1f ATR for any bars", InpWindow, gStats[1], gStats[2]), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Wider than the usual range after %.0f%% of releases", gStats[3]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Momentum sign matched the bigger side %.0f%%   best side %.1f ATR", gStats[5], gStats[4]), clrWhite, 9);
   MakeLabel("n1", 10, 180, "Range = next bars high-low in ATR. ~50% = coin flip.", clrSlateGray, 8);
   MakeLabel("f1", 10, 214, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 226, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, BufMom, INDICATOR_DATA); SetIndexBuffer(1, BufMomC, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, BufDot, INDICATOR_DATA); SetIndexBuffer(3, BufDotC, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(4, BufSq, INDICATOR_CALCULATIONS); SetIndexBuffer(5, BufRatio, INDICATOR_CALCULATIONS);
   PlotIndexSetInteger(1, PLOT_ARROW, 159);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Squeeze Meter");
   IndicatorSetInteger(INDICATOR_DIGITS, 2);
   if(InpBBLen < 5 || InpKCLen < 5 || InpMinBars < 2 || InpWindow < 5 || InpBBMult <= 0 || InpKCMult <= 0)
     {
      Print("AT24 Squeeze Meter: need lengths >= 5, at least 2 squeeze bars and a window of 5+ bars.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gStats, 8);
   for(int z = 0; z < 8; z++) gStats[z] = 0.0;
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
   if(rates_total < MathMax(InpBBLen, InpKCLen) + 60) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only (the forming bar can still change): no repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      double h[], l[], c[], mid[], mom[], at[], ratio[]; int sq[];
      ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb); ArrayResize(mid, nb); ArrayResize(mom, nb); ArrayResize(at, nb); ArrayResize(ratio, nb); ArrayResize(sq, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      AT24SQ_Calc(nb, h, l, c, InpBBLen, InpBBMult, InpKCLen, InpKCMult, InpAtr, mid, mom, at, ratio, sq);
      gNEv = AT24SQ_Events(nb, h, l, c, mid, at, sq, InpMinBars, InpWindow, gEv);
      double baseline = AT24SQ_Baseline(nb, h, l, at, InpWindow, MathMax(InpBBLen, InpKCLen));
      AT24SQ_Stats(gEv, gNEv, baseline, gStats);
      ArrayInitialize(BufMom, EMPTY_VALUE); ArrayInitialize(BufDot, EMPTY_VALUE); ArrayInitialize(BufMomC, 0); ArrayInitialize(BufDotC, 0);
      ArrayInitialize(BufSq, 0); ArrayInitialize(BufRatio, 0);
      int start = MathMax(InpBBLen, InpKCLen);
      for(int q2 = start; q2 < nb; q2++)
        {
         int i = base + q2;
         BufMom[i] = mom[q2];
         double prev = mom[q2 - 1];
         BufMomC[i] = (mom[q2] >= 0.0) ? (mom[q2] >= prev ? 0 : 1) : (mom[q2] <= prev ? 2 : 3);
         BufDot[i] = 0.0;
         BufDotC[i] = (sq[q2] == 1) ? 1 : 0;
         BufSq[i] = sq[q2]; BufRatio[i] = ratio[q2];
        }
      //--- state of the last closed bar
      gRunNow = 0;
      for(int z = nb - 1; z >= 0 && sq[z] == 1; z--) gRunNow++;
      gSinceRelease = -1;
      if(gRunNow == 0)
        {
         int z2 = nb - 1, k = 0;
         while(z2 >= 0 && sq[z2] == 0 && k < 200) { z2--; k++; }
         int run = 0;
         for(int z3 = z2; z3 >= 0 && sq[z3] == 1; z3--) run++;
         if(z2 >= 0 && run >= InpMinBars) gSinceRelease = k - 1;
        }
      gMomNow = (mom[nb - 1] > 0.0) ? 1 : (mom[nb - 1] < 0.0 ? -1 : 0);
      gRatioNow = ratio[nb - 1];
      if(InpAlertRelease && gSinceRelease == 0 && time[total - 1] != gAlertBar)
        {
         gAlertBar = time[total - 1];
         string msg = StringFormat("AT24 Squeeze Meter %s: squeeze released (momentum %s)", _Symbol, gMomNow > 0 ? "UP" : "DOWN");
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
     }
   UpdateDash();
   return rates_total;
  }
