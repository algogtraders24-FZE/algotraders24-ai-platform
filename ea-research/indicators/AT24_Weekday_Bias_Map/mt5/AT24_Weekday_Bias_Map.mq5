//+------------------------------------------------------------------+
//| AT24 Weekday Bias Map (MT5)                                      |
//| Does your market lean up or down on certain weekdays? Mean daily |
//| return per weekday with significance, a chance check, and        |
//| whether the pattern held from the first half of the history to   |
//| the second.                                                      |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Weekday Bias Map - daily return bias by weekday with t-stats and a persistence check."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_WD_Core.mqh"

#resource "wd_logo56.bmp"

input group "=== History ==="
input int    InpDays          = 3000;   // Daily candles analysed (the terminal gives what it has)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24WD_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0, gDow = 0;
double gOut[], gSum[];
datetime gBuiltAt = 0;
string gNames[7] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

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
   ObjectSetInteger(0, n, OBJPROP_XSIZE, MathMax(1, w));
   ObjectSetInteger(0, n, OBJPROP_YSIZE, MathMax(1, h));
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

void BuildFrame()
  {
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40', C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::wd_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 WEEKDAY BIAS MAP", C'230,190,80', 10, true);
   if(gBars < 300)
     {
      MakeLabel("t2", 70, 26, "LOADING DAILY HISTORY", clrSlateGray, 11, true);
      return;
     }
   double mx = 0.0;
   for(int d = 1; d <= 5; d++) mx = MathMax(mx, MathAbs(gOut[d * AT24WD_COLS + 1]));
   if(mx <= 0.0) mx = 1.0;
   int x0 = 20, base = 108, maxH = 34;
   bool anySig = (gSum[0] > 0.0);
   MakeLabel("t2", 70, 26, anySig ? "A WEEKDAY STANDS OUT (in the past)" : "NO WEEKDAY STANDS OUT", anySig ? clrGold : clrSlateGray, 11, true);
   MakeRect("axis", 10, base, 340, 1, C'90,100,120', C'90,100,120');
   for(int d = 1; d <= 5; d++)
     {
      double m = gOut[d * AT24WD_COLS + 1], tt = gOut[d * AT24WD_COLS + 2];
      int hgt = (int)MathRound(maxH * MathAbs(m) / mx);
      bool pos = m >= 0.0, sig2 = (MathAbs(tt) >= 1.96), sig3 = (MathAbs(tt) >= 2.58);
      color col = pos ? (sig2 ? clrLimeGreen : C'40,100,60') : (sig2 ? clrTomato : C'120,60,60');
      color bd = (d == gDow) ? clrWhite : (sig3 ? clrGold : col);
      int bx = x0 + (d - 1) * 66;
      MakeRect("bar" + IntegerToString(d), bx, pos ? base - hgt : base + 1, 40, MathMax(hgt, 1), col, bd);
      MakeLabel("nm" + IntegerToString(d), bx + 8, base + 38, gNames[d], d == gDow ? clrWhite : clrSlateGray, 8, d == gDow);
      MakeLabel("v" + IntegerToString(d), bx + 2, 46, StringFormat("%+.1f bp", m), clrSilver, 7);
     }
   MakeLabel("l1", 10, 172, "Mean daily return per weekday (bp); t-stats:", clrSilver, 8);
   MakeLabel("l2", 10, 186, StringFormat("Mon %+.2f  Tue %+.2f  Wed %+.2f  Thu %+.2f  Fri %+.2f", gOut[1 * 7 + 2], gOut[2 * 7 + 2], gOut[3 * 7 + 2], gOut[4 * 7 + 2], gOut[5 * 7 + 2]), clrWhite, 8);
   MakeLabel("l3", 10, 202, StringFormat("|t|>=1.96: %d of 5 (chance ~0.25)  same sign both halves: %d  corr %+.2f", (int)gSum[0], (int)gSum[3], gSum[2]), clrWhite, 7);
   MakeLabel("n1", 10, 218, "Gold's drift lifts every day; with 5 points corr is unstable.", clrSlateGray, 7);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, StringFormat("not a signal or a forecast. %d daily candles. algotraders24.ai", gBars), clrSlateGray, 7);
  }

bool Rebuild()
  {
   MqlRates r[];
   int n = CopyRates(_Symbol, PERIOD_D1, 1, InpDays, r);
   if(n < 300) { gBars = MathMax(n, 0); return false; }
   double ret[]; int dow[]; ArrayResize(ret, n); ArrayResize(dow, n);
   for(int i = 0; i < n; i++) { ret[i] = MathLog(r[i].close / r[i].open); dow[i] = (int)((((long)r[i].time / 86400) + 4) % 7); }
   AT24WD_Stats(n, ret, dow, gOut, gSum);
   gBars = n;
   B0[0] = gSum[0]; B1[0] = gSum[1]; B2[0] = gSum[2]; B3[0] = gSum[3]; B4[0] = n;
   return true;
  }

void Refresh()
  {
   datetime day = iTime(_Symbol, PERIOD_D1, 0);
   gDow = (int)((((long)TimeCurrent() / 86400) + 4) % 7);
   if(gBuiltAt != day || gBars < 300) { if(Rebuild()) gBuiltAt = day; }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Weekday Bias Map");
   if(InpDays < 400 || InpDays > 20000)
     {
      Print("AT24 Weekday Bias Map: daily candles 400-20000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gOut, 7 * AT24WD_COLS); ArrayResize(gSum, 5);
   for(int z = 0; z < 7 * AT24WD_COLS; z++) gOut[z] = 0.0;
   for(int z = 0; z < 5; z++) gSum[z] = 0.0;
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
