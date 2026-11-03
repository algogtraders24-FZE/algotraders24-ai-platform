//+------------------------------------------------------------------+
//| AT24 Range Detector (MT5)                                        |
//| Consolidation ranges found when trend strength (ADX) fades -     |
//| and how such ranges really ended on YOUR symbol.                 |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Range Detector - ADX-fade consolidation boxes, state and real range statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_Range_Core.mqh"

#resource "rd_logo56.bmp"

input group "=== Detection ==="
input int    InpAdxLen        = 14;     // ADX length
input int    InpSlope         = 2;      // Compare ADX with the value this many bars earlier
input int    InpDeclineBars   = 2;      // Consecutive falling readings needed to open a range
input double InpMinPeak       = 25.0;   // ADX must have been at least this high recently
input int    InpPeakLook      = 40;     // ... within this many bars
input double InpBreakPct      = 30.0;   // Breakout close: % of the bar's range beyond the box
input bool   InpEndOnRise     = false;  // Also end a range when ADX rises again
input int    InpMinBars       = 8;      // Minimum bars for a range to count
input int    InpFakeBars      = 5;      // Bars to judge a false breakout
input group "=== Look ==="
input int    InpHistoryBars   = 8000;   // Bars analysed
input int    InpBoxes         = 12;     // Ranges drawn
input color  InpOpenColor     = clrGold;       // Open range
input color  InpUpColor       = clrLimeGreen;  // Broke up
input color  InpDownColor     = clrTomato;     // Broke down
input color  InpRiseColor     = clrSlateGray;  // Ended by strength rising
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertBreak    = false;  // Alert when a range breaks out
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24RD_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
AT24RG_Range gRg[];
int    gN = 0;
double gStats[];
double gAdxNow = 0.0;
datetime gAlertBar = 0;
double gPos = 0.0;

#define DASH_W 360
#define DASH_H 262

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::rd_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

color EndColor(const int e) { return (e == 0) ? InpOpenColor : (e == 1 ? InpUpColor : (e == 2 ? InpDownColor : InpRiseColor)); }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

void DrawBoxes(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "bx");
   int shown = 0;
   for(int i = gN - 1; i >= 0 && shown < InpBoxes; i--, shown++)
     {
      string nm = PFX + "bx" + IntegerToString(gRg[i].start);
      datetime t1 = time[base + gRg[i].start];
      datetime t2 = time[MathMin(base + gRg[i].last, rates_total - 1)];
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, gRg[i].hi, t2, gRg[i].lo);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, EndColor(gRg[i].end));
      ObjectSetInteger(0, nm, OBJPROP_FILL, false);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, gRg[i].end == 0 ? 2 : 1);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
     }
  }

void UpdateDash(const double price)
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 RANGE DETECTOR", C'230,190,80', 10, true);
   bool open = (gN > 0 && gRg[gN - 1].end == 0);
   if(open)
     {
      AT24RG_Range r = gRg[gN - 1];
      MakeLabel("t2", 70, 26, StringFormat("IN A RANGE  (%d bars)", r.last - r.start + 1), InpOpenColor, 11, true);
      MakeLabel("l1", 10, 66, StringFormat("Box %s - %s   price at %.0f%% of the box", DoubleToString(r.lo, Dg()), DoubleToString(r.hi, Dg()), gPos), clrWhite, 9);
     }
   else
     {
      MakeLabel("t2", 70, 26, "NO RANGE RIGHT NOW", clrSlateGray, 11, true);
      MakeLabel("l1", 10, 66, "A box opens when ADX fades from a strong trend.", clrSlateGray, 9);
     }
   MakeLabel("l2", 10, 82, StringFormat("ADX %.1f   (needs %.0f recently, falling %d x)", gAdxNow, InpMinPeak, InpDeclineBars), clrWhite, 9);
   MakeLabel("h1", 10, 108, StringFormat("Last %d bars: %d finished ranges", InpHistoryBars, (int)gStats[0]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("Median %.0f bars, %.1f ATR tall", gStats[1], gStats[2]), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Ended: up %.0f%%  down %.0f%%  strength %.0f%%", gStats[3], gStats[4], gStats[5]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Breakout with the prior move %.0f%% (%d)", gStats[6], (int)gStats[8]), clrWhite, 9);
   MakeLabel("s4", 10, 174, StringFormat("Fell back inside within %d bars %.0f%% (%d)", InpFakeBars, gStats[7], (int)gStats[9]), clrWhite, 9);
   MakeLabel("n1", 10, 196, "Prior move = last 20 bars before the box. ~50% = coin flip.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Range Detector");
   if(InpAdxLen < 5 || InpAdxLen > 40 || InpSlope < 1 || InpDeclineBars < 1 || InpMinBars < 3 || InpBreakPct < 0 || InpBreakPct > 100)
     {
      Print("AT24 Range Detector: ADX length 5-40, slope >= 1, decline bars >= 1, min bars >= 3, breakout % 0-100.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gStats, 10);
   for(int z = 0; z < 10; z++) gStats[z] = 0.0;
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
   if(rates_total < 200) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: ranges and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      double h[], l[], c[], adx[], atr[];
      ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb); ArrayResize(adx, nb); ArrayResize(atr, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      AT24RG_Adx(nb, h, l, c, InpAdxLen, adx, atr);
      gN = AT24RG_Find(nb, h, l, c, adx, atr, InpSlope, InpDeclineBars, InpMinPeak, InpPeakLook, InpBreakPct, InpEndOnRise, InpMinBars, InpFakeBars, gRg);
      AT24RG_Stats(gRg, gN, gStats);
      gAdxNow = adx[nb - 1];
      DrawBoxes(base, time, rates_total);
      if(InpAlertBreak && gN > 0 && gRg[gN - 1].end != 0 && gRg[gN - 1].end != 3 && gRg[gN - 1].last + 1 == nb - 1 && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string msg = StringFormat("AT24 Range Detector %s: range broke %s", _Symbol, gRg[gN - 1].end == 1 ? "UP" : "DOWN");
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      //--- buffers describe the current (open) range
      bool open = (gN > 0 && gRg[gN - 1].end == 0);
      B0[0] = open ? gRg[gN - 1].hi : 0.0; B1[0] = open ? gRg[gN - 1].lo : 0.0; B2[0] = open ? 1.0 : 0.0; B3[0] = gAdxNow;
      B4[0] = open ? gRg[gN - 1].last - gRg[gN - 1].start + 1 : 0.0;
     }
   bool open2 = (gN > 0 && gRg[gN - 1].end == 0);
   double price = close[rates_total - 1];
   gPos = (open2 && gRg[gN - 1].hi > gRg[gN - 1].lo) ? 100.0 * (price - gRg[gN - 1].lo) / (gRg[gN - 1].hi - gRg[gN - 1].lo) : 0.0;
   UpdateDash(price);
   return rates_total;
  }
