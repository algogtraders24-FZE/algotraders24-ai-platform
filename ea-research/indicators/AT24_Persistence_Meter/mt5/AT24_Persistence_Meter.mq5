//+------------------------------------------------------------------+
//| AT24 Persistence Meter (MT5)                                     |
//| Do price moves on this symbol tend to continue, reverse or are   |
//| they random right now (variance ratio test) - and did that       |
//| reading ever predict the next move on YOUR data?                 |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Persistence Meter - variance-ratio test of trending / mean-reverting / random + real study of whether it predicted the next move."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_PR_Core.mqh"

#resource "pr_logo56.bmp"

input group "=== Test ==="
input int    InpWindow        = 400;    // Bars in the test window
input int    InpQ             = 8;      // Main move length q (bars) for the state
input int    InpHorizon       = 32;     // Bars: previous move / next move for the study
input double InpZ             = 1.645;  // z threshold (1.645 = one-sided 5 %)
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertChange   = false;  // Alert when the state changes
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24PR_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gState = 0, gLastState = -1;
double gVr[3], gZ[3], gHu[3], gStudy[8];
int    gQs[3];
datetime gAlertBar = 0;

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::pr_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string Ci(const double pct, const double n)
  {
   if(n < 1.0) return "-";
   double hw = 1.96 * MathSqrt(MathMax(pct * (100.0 - pct), 0.0) / n);   // 95% half-width in percentage points
   return StringFormat("%.0f%% (n=%d, +-%.0f)", pct, (int)n, hw);
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 PERSISTENCE METER", C'230,190,80', 10, true);
   string st = gState == 1 ? "MOVES TEND TO CONTINUE" : (gState == 2 ? "MOVES TEND TO REVERSE" : "LOOKS LIKE A RANDOM WALK");
   color sc = gState == 1 ? clrLimeGreen : (gState == 2 ? clrGold : clrSlateGray);
   MakeLabel("t2", 70, 26, st, sc, 11, true);
   for(int k = 0; k < 3; k++)
      MakeLabel("v" + IntegerToString(k), 10, 62 + k * 16, StringFormat("%2d-bar moves:  VR %.2f   z %+.2f   exponent %.2f%s", gQs[k], gVr[k], gZ[k], gHu[k], gQs[k] == InpQ ? "   <- state" : ""), gQs[k] == InpQ ? clrWhite : clrSilver, 9);
   MakeLabel("h1", 10, 114, StringFormat("Study: %d windows of %d bars (q=%d)", (int)gStudy[0], InpHorizon, InpQ), C'230,190,80', 9, true);
   double nt = gStudy[1], nm = gStudy[2], nr = gStudy[3];
   MakeLabel("s1", 10, 132, StringFormat("Time trending %.0f%%  reverting %.0f%%  random %.0f%%", gStudy[0] > 0 ? 100.0 * nt / gStudy[0] : 0.0, gStudy[0] > 0 ? 100.0 * nm / gStudy[0] : 0.0, gStudy[0] > 0 ? 100.0 * nr / gStudy[0] : 0.0), clrWhite, 9);
   MakeLabel("s2", 10, 148, "Next move went the SAME way as the last move:", C'230,190,80', 9, true);
   MakeLabel("s3", 10, 164, "Any time: " + Ci(gStudy[4], gStudy[0]), clrWhite, 9);
   MakeLabel("s4", 10, 180, "When trending: " + Ci(gStudy[5], nt), clrWhite, 9);
   MakeLabel("s5", 10, 196, "When reverting: " + Ci(gStudy[6], nm), clrWhite, 9);
   MakeLabel("n1", 10, 214, "Small samples: a gap from 'any time' inside +- is noise.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Persistence Meter");
   if(InpWindow < 100 || InpQ < 2 || InpQ * 4 > InpWindow || InpHorizon < 2 || InpZ <= 0.0 || InpHistoryBars < InpWindow * 2)
     {
      Print("AT24 Persistence Meter: window >= 100, q >= 2 and q*4 <= window, horizon >= 2, z > 0, history >= 2x window.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   gQs[0] = 4; gQs[1] = InpQ; gQs[2] = InpQ * 2;
   if(InpQ == 4) { gQs[1] = 4; gQs[0] = 2; }
   for(int z = 0; z < 8; z++) gStudy[z] = 0.0;
   for(int k = 0; k < 3; k++) { gVr[k] = 1.0; gZ[k] = 0.0; gHu[k] = 0.5; }
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
   if(rates_total < InpHistoryBars / 2 + 100) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: ratios and the study never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      double c[], r[]; ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) c[q] = close[base + q];
      AT24PR_Returns(nb, c, r);
      for(int k = 0; k < 3; k++)
        {
         double vr, z;
         if(AT24PR_Vr(r, nb - 1, InpWindow, gQs[k], vr, z)) { gVr[k] = vr; gZ[k] = z; gHu[k] = AT24PR_Hurst(vr, gQs[k]); }
        }
      gState = (gZ[1] >= InpZ) ? 1 : ((gZ[1] <= -InpZ) ? 2 : 3);
      AT24PR_Study(nb, c, r, InpWindow, InpQ, InpHorizon, InpHorizon, InpZ, gStudy);
      if(InpAlertChange && gLastState > 0 && gState != gLastState && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string msg = StringFormat("AT24 Persistence Meter %s: now %s (VR %.2f, z %+.2f)", _Symbol, gState == 1 ? "TRENDING" : (gState == 2 ? "MEAN-REVERTING" : "RANDOM WALK"), gVr[1], gZ[1]);
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      gLastState = gState;
      B0[0] = gVr[1]; B1[0] = gZ[1]; B2[0] = gHu[1]; B3[0] = gState; B4[0] = gStudy[5];
     }
   UpdateDash();
   return rates_total;
  }
