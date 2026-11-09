//+------------------------------------------------------------------+
//| AT24 Order Block Lab (MT5)                                       |
//| "Order blocks" (the last opposite candle before a strong move)   |
//| marked on closed bars while untouched - and what price really    |
//| did when it came back, against a mirrored control zone.          |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Order Block Lab - untouched order-block zones + honest touch/reaction statistics vs a control zone."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_OB_Core.mqh"

#resource "ob_logo56.bmp"

input group "=== Detection ==="
input double InpMoveAtr       = 1.0;    // Strong move = a close this many ATR beyond the candle within 3 bars
input int    InpTouchWindow   = 100;    // Bars after confirmation in which a return counts
input int    InpLook          = 24;     // Bars after a touch used to judge the reaction
input double InpReactFrac      = 0.5;   // Reaction size, in ATR
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Look ==="
input int    InpMaxZones      = 6;      // Untouched blocks drawn (newest first)
input color  InpBullColor     = C'30,120,70';   // Bullish block
input color  InpBearColor     = C'140,50,50';   // Bearish block
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertNew      = false;  // Alert when a new block is confirmed
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24OB_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gNb = 0, gM = 0, gOpen = 0;
AT24OB_Block gB[];
double gSt[7];
double gPrice = 0.0;
bool   gOpenF[];      // still untouched up to the last closed bar (not only inside the statistics window)
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ob_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

//--- a block is open (drawn) while no bar after its confirmation has reached it
bool IsOpen(const int k) { return gOpenF[k]; }

void DrawZones(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "zn");
   datetime tEnd = time[rates_total - 1] + PeriodSeconds() * 15;
   int shown = 0;
   for(int k = gM - 1; k >= 0 && shown < InpMaxZones; k--)
     {
      if(!IsOpen(k)) continue;
      shown++;
      string nm = PFX + "zn" + IntegerToString(gB[k].bar);
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, time[base + gB[k].bar], gB[k].top, tEnd, gB[k].bottom);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, gB[k].dir == 1 ? InpBullColor : InpBearColor);
      ObjectSetInteger(0, nm, OBJPROP_FILL, true);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string tx = nm + "t";
      ObjectCreate(0, tx, OBJ_TEXT, 0, tEnd, (gB[k].top + gB[k].bottom) / 2.0);
      ObjectSetString(0, tx, OBJPROP_TEXT, gB[k].dir == 1 ? "OB up" : "OB down");
      ObjectSetInteger(0, tx, OBJPROP_COLOR, gB[k].dir == 1 ? clrLimeGreen : clrTomato);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_RIGHT);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
  }

string Ci(const double p, const double n)
  {
   if(n < 1.0) return "-";
   return StringFormat("%.0f%% (+-%.0f, n=%d)", p, 1.96 * MathSqrt(MathMax(p * (100.0 - p), 0.0) / n), (int)n);
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 ORDER BLOCK LAB", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, StringFormat("%d UNTOUCHED BLOCKS", gOpen), clrWhite, 11, true);
   //--- nearest untouched block above / below the last close
   double up = 0.0, dn = 0.0;
   for(int k = 0; k < gM; k++)
     {
      if(!IsOpen(k)) continue;
      double mid = (gB[k].top + gB[k].bottom) / 2.0;
      if(mid > gPrice && (up == 0.0 || mid < up)) up = mid;
      if(mid <= gPrice && (dn == 0.0 || mid > dn)) dn = mid;
     }
   MakeLabel("l1", 10, 62, StringFormat("Nearest untouched block above: %s", up > 0.0 ? DoubleToString(up, Dg()) : "-"), clrWhite, 9);
   MakeLabel("l2", 10, 78, StringFormat("Nearest untouched block below: %s", dn > 0.0 ? DoubleToString(dn, Dg()) : "-"), clrWhite, 9);
   MakeLabel("h1", 10, 104, StringFormat("Last %d bars: %d blocks (move >= %.1f ATR)", InpHistoryBars, (int)gSt[0], InpMoveAtr), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 122, StringFormat("Price came back within %d bars:", InpTouchWindow), clrSilver, 9);
   MakeLabel("s2", 10, 138, StringFormat("  block %.0f%%    control zone %.0f%%", gSt[1], gSt[2]), clrWhite, 9);
   MakeLabel("s3", 10, 156, "Reacted (moved away before breaking it):", clrSilver, 9);
   MakeLabel("s4", 10, 172, "  block " + Ci(gSt[3], gSt[5]), clrWhite, 9);
   MakeLabel("s5", 10, 188, "  control " + Ci(gSt[4], gSt[6]), clrWhite, 9);
   MakeLabel("n1", 10, 208, "Control = block mirrored through the confirming price.", clrSlateGray, 7);
   MakeLabel("n2", 10, 220, "Block ~ control = no 'order block' effect.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Order Block Lab");
   if(InpMoveAtr <= 0.0 || InpTouchWindow < 5 || InpLook < 1 || InpReactFrac <= 0.0 || InpHistoryBars < 1000)
     {
      Print("AT24 Order Block Lab: move > 0 ATR, touch window >= 5, look >= 1, reaction > 0, history >= 1000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 7; z++) gSt[z] = 0.0;
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
   if(rates_total < 1200) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: blocks exist only after the confirming bar has closed; nothing repaints
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      gNb = nb;
      double o[], h[], l[], c[]; ArrayResize(o, nb); ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { o[q] = open[base + q]; h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      gM = AT24OB_Find(nb, o, h, l, c, InpMoveAtr, InpTouchWindow, InpLook, InpReactFrac, gB);
      double st[]; AT24OB_Stats(nb, gB, gM, InpTouchWindow, InpLook, st);
      for(int z = 0; z < 7; z++) gSt[z] = st[z];
      gPrice = c[nb - 1];
      ArrayResize(gOpenF, gM);
      for(int k = 0; k < gM; k++)
        {
         bool opn = true;
         for(int u = gB[k].conf + 1; u < nb; u++)
            if((gB[k].dir == 1 && l[u] <= gB[k].top) || (gB[k].dir == -1 && h[u] >= gB[k].bottom)) { opn = false; break; }
         gOpenF[k] = opn;
        }
      gOpen = 0;
      for(int k = 0; k < gM; k++) if(IsOpen(k)) gOpen++;
      DrawZones(base, time, rates_total);
      if(InpAlertNew && gM > 0 && gB[gM - 1].conf == nb - 1 && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string msg = StringFormat("AT24 Order Block Lab %s: new %s block %s - %s", _Symbol, gB[gM - 1].dir == 1 ? "bullish" : "bearish", DoubleToString(gB[gM - 1].bottom, Dg()), DoubleToString(gB[gM - 1].top, Dg()));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      B0[0] = gOpen; B1[0] = gM > 0 ? gB[gM - 1].dir : 0.0; B2[0] = gM > 0 ? gB[gM - 1].top : 0.0; B3[0] = gM > 0 ? gB[gM - 1].bottom : 0.0; B4[0] = gSt[3];
     }
   UpdateDash();
   return rates_total;
  }
