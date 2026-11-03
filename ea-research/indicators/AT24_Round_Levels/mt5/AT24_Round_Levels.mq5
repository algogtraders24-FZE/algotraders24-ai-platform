//+------------------------------------------------------------------+
//| AT24 Round Levels (MT5)                                          |
//| Round-number grid + nearest levels - and whether price REALLY    |
//| reacts at round numbers on YOUR symbol (vs control levels).      |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Round Levels - round-number grid, nearest levels and a real test against control levels."
#property description "Defaults suit Gold (10 / 50 / 100 dollars). Set the steps for other symbols. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 6
#property indicator_plots   0

#include "AT24_Round_Core.mqh"

#resource "rn_logo56.bmp"

input group "=== Levels (price units) ==="
input double InpStep1         = 10.0;   // Fine step
input double InpStep2         = 50.0;   // Middle step
input double InpStep3         = 100.0;  // Big step
input int    InpLines1        = 6;      // Fine lines drawn each side of price
input int    InpLines2        = 4;      // Middle lines each side
input int    InpLines3        = 3;      // Big lines each side
input group "=== Statistics ==="
input int    InpWindow        = 20;     // Bars to decide bounce or break after a touch
input double InpReactAtr      = 1.0;    // Reaction size in ATR (move away / through)
input int    InpAtr           = 14;     // ATR length
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Colours ==="
input color  InpColor1        = clrDimGray;     // Fine lines
input color  InpColor2        = clrDeepSkyBlue; // Middle lines
input color  InpColor3        = clrGold;        // Big lines
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertTouch    = false;  // Alert when a middle/big level is touched
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[], B5[];
string PFX = "AT24RN_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
int    gReal[3][4], gCtrl[3][4];
datetime gAlertBar = 0;

#define DASH_W 380
#define DASH_H 268

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::rn_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void DrawGrid(const double price, const double step, const int lines, const color col, const int width, const int idx)
  {
   if(step <= 0.0 || lines <= 0) return;
   double base = AT24RN_Below(price, step);
   for(int k = -lines + 1; k <= lines; k++)
     {
      double lv = base + k * step;
      string n = PFX + "g" + IntegerToString(idx) + "_" + IntegerToString(k + 100);
      if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_HLINE, 0, 0, lv);
      ObjectSetDouble(0, n, OBJPROP_PRICE, lv);
      ObjectSetInteger(0, n, OBJPROP_COLOR, col);
      ObjectSetInteger(0, n, OBJPROP_STYLE, idx == 0 ? STYLE_DOT : STYLE_SOLID);
      ObjectSetInteger(0, n, OBJPROP_WIDTH, width);
      ObjectSetInteger(0, n, OBJPROP_BACK, true);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetString(0, n, OBJPROP_TEXT, DoubleToString(lv, _Digits));
     }
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }
string Fs(const double step) { return DoubleToString(step, (step == MathFloor(step)) ? 0 : Dg()); }

string StatLine(const int idx, const double step)
  {
   int n = gReal[idx][0];
   if(n == 0) return StringFormat("Step %s: no touches measured", Fs(step));
   int nc = gCtrl[idx][0];
   return StringFormat("%s  n=%d  bounce %.0f%% (ctrl %.0f%%)  break %.0f%% (ctrl %.0f%%)", Fs(step), n,
                       100.0 * gReal[idx][1] / n, nc > 0 ? 100.0 * gCtrl[idx][1] / nc : 0.0,
                       100.0 * gReal[idx][2] / n, nc > 0 ? 100.0 * gCtrl[idx][2] / nc : 0.0);
  }

void UpdateAll(const bool redraw, const double price)
  {
   double st[3]; st[0] = InpStep1; st[1] = InpStep2; st[2] = InpStep3;
   B0[0] = AT24RN_Below(price, st[0]); B1[0] = AT24RN_Above(price, st[0]);
   B2[0] = AT24RN_Below(price, st[1]); B3[0] = AT24RN_Above(price, st[1]);
   B4[0] = AT24RN_Below(price, st[2]); B5[0] = AT24RN_Above(price, st[2]);
   if(redraw)
     {
      DrawGrid(price, st[0], InpLines1, InpColor1, 1, 0);
      DrawGrid(price, st[1], InpLines2, InpColor2, 1, 1);
      DrawGrid(price, st[2], InpLines3, InpColor3, 2, 2);
     }
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 ROUND LEVELS", C'230,190,80', 10, true);
   double nb = AT24RN_Below(price, st[2]), na = AT24RN_Above(price, st[2]);
   double nearest = (price - nb <= na - price) ? nb : na;
   MakeLabel("t2", 70, 26, StringFormat("Nearest big level %s  (%+.2f)", DoubleToString(nearest, Dg()), price - nearest), InpColor3, 11, true);
   for(int s = 0; s < 3; s++)
     {
      double lo = AT24RN_Below(price, st[s]), hi = AT24RN_Above(price, st[s]);
      MakeLabel("n" + IntegerToString(s), 10, 66 + s * 16, StringFormat("Step %s  below %s (%.2f)  above %s (+%.2f)", Fs(st[s]),
                DoubleToString(lo, Dg()), price - lo, DoubleToString(hi, Dg()), hi - price), s == 0 ? clrSilver : (s == 1 ? InpColor2 : InpColor3), 9);
     }
   MakeLabel("h1", 10, 122, StringFormat("Touches in the last %d bars (resolved in %d):", InpHistoryBars, InpWindow), C'230,190,80', 9, true);
   for(int s2 = 0; s2 < 3; s2++) MakeLabel("s" + IntegerToString(s2), 10, 140 + s2 * 16, StatLine(s2, st[s2]), clrWhite, 8);
   MakeLabel("h2", 10, 194, StringFormat("Bounce = %.1f ATR away before the same move through.", InpReactAtr), clrSlateGray, 8);
   MakeLabel("h3", 10, 208, "ctrl = levels half a step away. Equal = no effect.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS); SetIndexBuffer(5, B5, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true); ArraySetAsSeries(B5, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Round Levels");
   if(InpStep1 <= 0 || InpStep2 <= InpStep1 || InpStep3 <= InpStep2 || InpWindow < 3 || InpReactAtr <= 0)
     {
      Print("AT24 Round Levels: need 0 < step1 < step2 < step3, a window of 3+ bars and a positive reaction size.");
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
   if(rates_total < InpAtr + 60) return 0;
   bool recalc = (prev_calculated == 0 || rates_total != gLastTotal);
   if(recalc)
     {
      gLastTotal = rates_total;
      //--- closed bars only: statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      double h[], l[], c[], at[];
      ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb); ArrayResize(at, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      AT24RN_Atr(nb, h, l, c, InpAtr, at);
      double steps[3]; steps[0] = InpStep1; steps[1] = InpStep2; steps[2] = InpStep3;
      for(int s = 0; s < 3; s++)
        {
         int r[], k[];
         AT24RN_Scan(nb, h, l, c, at, steps[s], 0.0, InpWindow, InpReactAtr, InpAtr, r);
         AT24RN_Scan(nb, h, l, c, at, steps[s], 0.5, InpWindow, InpReactAtr, InpAtr, k);
         for(int z = 0; z < 4; z++) { gReal[s][z] = r[z]; gCtrl[s][z] = k[z]; }
        }
      if(InpAlertTouch && nb > 2)
        {
         int ib = nb - 1;
         for(int s2 = 1; s2 < 3; s2++)
           {
            double lv = MathRound(c[ib] / steps[s2]) * steps[s2];
            bool touchNow = (l[ib] <= lv && lv <= h[ib]) && !(l[ib - 1] <= lv && lv <= h[ib - 1]);
            if(touchNow && time[base + ib] != gAlertBar)
              {
               gAlertBar = time[base + ib];
               string msg = StringFormat("AT24 Round Levels %s: touched %s", _Symbol, DoubleToString(lv, _Digits));
               Alert(msg);
               if(InpAlertPush) SendNotification(msg);
              }
           }
        }
     }
   UpdateAll(recalc, close[rates_total - 1]);
   return rates_total;
  }
