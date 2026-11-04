//+------------------------------------------------------------------+
//| AT24 Candle Pattern Lab (MT5)                                    |
//| Engulfing and pin-bar candles marked on closed bars - and what   |
//| price really did after them on YOUR symbol, against the         |
//| unconditional rate.                                              |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Candle Pattern Lab - engulfing / pin-bar markers + honest follow-through statistics with confidence intervals."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_CL_Core.mqh"

#resource "cl_logo56.bmp"

input group "=== Patterns ==="
input double InpMinAtr        = 0.5;    // Ignore candles smaller than this many ATR
input int    InpAtrLen        = 14;     // ATR length
input int    InpFollowBars    = 6;      // Bars after the pattern used for the statistics
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Look ==="
input int    InpMarkBars      = 150;    // Bars back to mark patterns
input color  InpBullColor     = clrLimeGreen;   // Bullish patterns
input color  InpBearColor     = clrTomato;      // Bearish patterns
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertNew      = false;  // Alert when a pattern forms on the last closed bar
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24CL_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gLastFlags = 0, gNb = 0;
double gSt[16];
datetime gAlertBar = 0;
string gNames[4] = {"Bullish engulfing", "Bearish engulfing", "Bullish pin bar", "Bearish pin bar"};
string gTags[4]  = {"BE", "SE", "PIN", "PIN"};

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
   ObjectSetInteger(0, n, OBJPROP_YSIZE, DASH_H);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::cl_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void Mark(const int base, const datetime &time[], const double &high[], const double &low[], const int &flags[], const int nb)
  {
   ObjectsDeleteAll(0, PFX + "mk");
   int from = MathMax(1, nb - InpMarkBars);
   for(int i = from; i < nb; i++)
     {
      if(flags[i] == 0) continue;
      for(int k = 0; k < 4; k++)
        {
         if((flags[i] & (1 << k)) == 0) continue;
         bool bull = (k % 2 == 0);
         string nm = PFX + "mk" + IntegerToString(i) + "_" + IntegerToString(k);
         double off = (high[base + i] - low[base + i]) * 0.25;
         ObjectCreate(0, nm, OBJ_TEXT, 0, time[base + i], bull ? low[base + i] - off : high[base + i] + off);
         ObjectSetString(0, nm, OBJPROP_TEXT, gTags[k]);
         ObjectSetInteger(0, nm, OBJPROP_COLOR, bull ? InpBullColor : InpBearColor);
         ObjectSetInteger(0, nm, OBJPROP_FONTSIZE, 8);
         ObjectSetString(0, nm, OBJPROP_FONT, "Segoe UI Semibold");
         ObjectSetInteger(0, nm, OBJPROP_ANCHOR, bull ? ANCHOR_UPPER : ANCHOR_LOWER);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
        }
     }
  }

string Row(const int k)
  {
   double n = gSt[k * 4], hit = gSt[k * 4 + 1], base = gSt[k * 4 + 2];
   if(n < 1.0) return "-";
   double hw = 1.96 * MathSqrt(MathMax(hit * (100.0 - hit), 0.0) / n);
   return StringFormat("n=%d  next %d bars: %.0f%% (+-%.0f) vs %.0f%% any bar", (int)n, InpFollowBars, hit, hw, base);
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 CANDLE PATTERN LAB", C'230,190,80', 10, true);
   string now = "";
   for(int k = 0; k < 4; k++) if((gLastFlags & (1 << k)) != 0) now += (now == "" ? "" : " + ") + gNames[k];
   MakeLabel("t2", 70, 26, now == "" ? "LAST CANDLE: NO PATTERN" : "LAST CANDLE: " + now, now == "" ? clrSlateGray : ((gLastFlags & 5) != 0 ? InpBullColor : InpBearColor), 10, true);
   MakeLabel("h1", 10, 62, StringFormat("What happened after (last %d bars, ATR filter %.1f)", InpHistoryBars, InpMinAtr), C'230,190,80', 9, true);
   for(int k = 0; k < 4; k++)
     {
      MakeLabel("a" + IntegerToString(k), 10, 82 + k * 32, gNames[k], k % 2 == 0 ? InpBullColor : InpBearColor, 9, true);
      MakeLabel("b" + IntegerToString(k), 10, 96 + k * 32, Row(k), clrWhite, 9);
     }
   MakeLabel("n1", 10, 214, "Hit = price moved the pattern's way. A real edge would sit", clrSlateGray, 8);
   MakeLabel("n2", 10, 226, "clearly beyond the +- interval above the 'any bar' rate.", clrSlateGray, 8);
   MakeLabel("f1", 10, 240, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 251, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Candle Pattern Lab");
   if(InpMinAtr < 0.0 || InpAtrLen < 2 || InpFollowBars < 1 || InpFollowBars > 200 || InpHistoryBars < 500)
     {
      Print("AT24 Candle Pattern Lab: min size >= 0, ATR length >= 2, follow bars 1-200, history >= 500.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 16; z++) gSt[z] = 0.0;
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
   if(rates_total < 600) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: patterns and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      gNb = nb;
      double o[], h[], l[], c[], atr[], st[]; int fl[];
      ArrayResize(o, nb); ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { o[q] = open[base + q]; h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      AT24CL_Atr(nb, h, l, c, InpAtrLen, atr);
      AT24CL_Detect(nb, o, h, l, c, atr, InpMinAtr, fl);
      AT24CL_Stats(nb, c, fl, InpFollowBars, st);
      for(int z = 0; z < 16; z++) gSt[z] = st[z];
      gLastFlags = fl[nb - 1];
      Mark(base, time, high, low, fl, nb);
      if(InpAlertNew && gLastFlags != 0 && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string what = "";
         for(int k = 0; k < 4; k++) if((gLastFlags & (1 << k)) != 0) what += (what == "" ? "" : " + ") + gNames[k];
         string msg = StringFormat("AT24 Candle Pattern Lab %s: %s on the last closed bar", _Symbol, what);
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      B0[0] = gLastFlags; B1[0] = gSt[1]; B2[0] = gSt[5]; B3[0] = gSt[9]; B4[0] = gSt[13];
     }
   UpdateDash();
   return rates_total;
  }
