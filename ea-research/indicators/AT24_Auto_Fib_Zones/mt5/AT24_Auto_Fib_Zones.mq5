//+------------------------------------------------------------------+
//| AT24 Auto Fib Zones (MT5)                                        |
//| Fibonacci levels on the latest CONFIRMED swing leg - and how     |
//| deep pullbacks really went on YOUR symbol.                       |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Auto Fib Zones - fib levels on the last confirmed swing leg + real pullback-depth statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_Fib_Core.mqh"

#resource "fib_logo56.bmp"

input group "=== Swings ==="
input int    InpSwingBars     = 5;      // Bars each side to confirm a swing
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Look ==="
input bool   InpShowGolden    = true;   // Shade the 38.2 - 61.8 zone
input color  InpUpColor       = clrLimeGreen;  // Levels after an up leg
input color  InpDownColor     = clrTomato;     // Levels after a down leg
input color  InpZoneColor     = C'60,70,40';   // Zone shading
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertZone     = false;  // Alert when the pullback reaches 38.2 %
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24FB_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
AT24FB_Swing gSw[];
int    gM = 0;
double gStats[];
double gDepth = 0.0;      // current pullback depth of the latest leg (1.0 = whole leg)
datetime gAlertBar = 0;
double gLevels[7] = {0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0};

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::fib_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

//--- 0 % = end of the leg (latest swing), 100 % = start of the leg
double LevelPrice(const AT24FB_Swing &a, const AT24FB_Swing &b, const double f)
  {
   return b.price + (a.price - b.price) * f;
  }

void DrawFib(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "lv");
   ObjectsDeleteAll(0, PFX + "zn");
   if(gM < 2) return;
   AT24FB_Swing a = gSw[gM - 2], b = gSw[gM - 1];
   color col = (b.dir == 1) ? InpUpColor : InpDownColor;
   datetime t1 = time[base + b.idx];
   datetime t2 = time[rates_total - 1] + PeriodSeconds() * 20;
   if(InpShowGolden)
     {
      string zn = PFX + "zn";
      ObjectCreate(0, zn, OBJ_RECTANGLE, 0, t1, LevelPrice(a, b, 0.382), t2, LevelPrice(a, b, 0.618));
      ObjectSetInteger(0, zn, OBJPROP_COLOR, InpZoneColor);
      ObjectSetInteger(0, zn, OBJPROP_FILL, true);
      ObjectSetInteger(0, zn, OBJPROP_BACK, true);
      ObjectSetInteger(0, zn, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, zn, OBJPROP_HIDDEN, true);
     }
   for(int i = 0; i < 7; i++)
     {
      string nm = PFX + "lv" + IntegerToString(i);
      double p = LevelPrice(a, b, gLevels[i]);
      ObjectCreate(0, nm, OBJ_TREND, 0, t1, p, t2, p);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
      ObjectSetInteger(0, nm, OBJPROP_STYLE, (i == 0 || i == 6) ? STYLE_SOLID : STYLE_DOT);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string tx = PFX + "lv" + IntegerToString(i) + "t";
      ObjectCreate(0, tx, OBJ_TEXT, 0, t2, p);
      ObjectSetString(0, tx, OBJPROP_TEXT, StringFormat("%.1f%%  %s", gLevels[i] * 100.0, DoubleToString(p, Dg())));
      ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_LEFT);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 AUTO FIB ZONES", C'230,190,80', 10, true);
   if(gM >= 2)
     {
      AT24FB_Swing a = gSw[gM - 2], b = gSw[gM - 1];
      bool up = (b.dir == 1);
      MakeLabel("t2", 70, 26, up ? "LAST LEG: UP" : "LAST LEG: DOWN", up ? InpUpColor : InpDownColor, 11, true);
      MakeLabel("l1", 10, 66, StringFormat("Leg %s -> %s  (%s)", DoubleToString(a.price, Dg()), DoubleToString(b.price, Dg()), DoubleToString(MathAbs(b.price - a.price), Dg())), clrWhite, 9);
      MakeLabel("l2", 10, 82, StringFormat("Pullback so far: %.1f%% of the leg", gDepth * 100.0), clrWhite, 9);
     }
   else
      MakeLabel("t2", 70, 26, "NOT ENOUGH SWINGS", clrSlateGray, 11, true);
   MakeLabel("h1", 10, 108, StringFormat("Last %d bars: %d legs (swing %d bars)", InpHistoryBars, (int)gStats[0], InpSwingBars), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("Median pullback %.1f%% of the leg", gStats[1] * 100.0), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Reached 38.2: %.0f%%  50: %.0f%%  61.8: %.0f%%", gStats[3], gStats[4], gStats[5]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Past 100%%: %.0f%%   Leg extreme beaten: %.0f%%", gStats[7], gStats[8]), clrWhite, 9);
   MakeLabel("s4", 10, 174, StringFormat("Shallow (<=61.8) then resumed: %.0f%% (%d)", gStats[9], (int)gStats[10]), clrWhite, 9);
   MakeLabel("n1", 10, 196, "Swings use closed bars only. ~50% resume = coin flip.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Auto Fib Zones");
   if(InpSwingBars < 2 || InpSwingBars > 30)
     {
      Print("AT24 Auto Fib Zones: swing bars must be 2-30.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gStats, 11);
   for(int z = 0; z < 11; z++) gStats[z] = 0.0;
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
      //--- closed bars only: swings, levels and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      double h[], l[]; ArrayResize(h, nb); ArrayResize(l, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; }
      gM = AT24FB_Swings(nb, h, l, InpSwingBars, gSw);
      AT24FB_Stats(gSw, gM, gStats);
      DrawFib(base, time, rates_total);
      gDepth = 0.0;
      if(gM >= 2)
        {
         double leg = MathAbs(gSw[gM - 1].price - gSw[gM - 2].price);
         double px = close[rates_total - 2];
         if(leg > 0.0) gDepth = (gSw[gM - 1].dir == 1) ? (gSw[gM - 1].price - px) / leg : (px - gSw[gM - 1].price) / leg;
         if(InpAlertZone && gDepth >= 0.382 && gDepth < 1.0 && time[rates_total - 2] != gAlertBar)
           {
            gAlertBar = time[rates_total - 2];
            string msg = StringFormat("AT24 Auto Fib Zones %s: pullback at %.1f%% of the last %s leg", _Symbol, gDepth * 100.0, gSw[gM - 1].dir == 1 ? "up" : "down");
            Alert(msg);
            if(InpAlertPush) SendNotification(msg);
           }
         B0[0] = gSw[gM - 2].price; B1[0] = gSw[gM - 1].price; B2[0] = gSw[gM - 1].dir; B3[0] = gDepth; B4[0] = gM;
        }
     }
   UpdateDash();
   return rates_total;
  }
