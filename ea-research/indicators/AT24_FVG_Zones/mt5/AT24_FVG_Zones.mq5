//+------------------------------------------------------------------+
//| AT24 FVG Zones (MT5)                                             |
//| Fair value gaps (three-bar imbalances) that price has not yet    |
//| filled - and how gaps really behaved on YOUR symbol.             |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 FVG Zones - open fair value gaps on closed bars + real revisit/fill statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_FVG_Core.mqh"

#resource "fvg_logo56.bmp"

input group "=== Detection ==="
input int    InpAtrLen        = 14;     // ATR length
input double InpMinAtr        = 0.3;    // Minimum gap height in ATR
input int    InpWindow        = 50;     // Bars used to judge revisit / fill
input int    InpReact         = 20;     // Bars used to judge a reaction after the first touch
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Look ==="
input int    InpMaxZones      = 8;      // Open gaps drawn (newest first)
input color  InpUpColor       = C'30,120,70';   // Bullish gap
input color  InpDownColor     = C'140,50,50';   // Bearish gap
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertNew      = false;  // Alert when a new gap forms
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24FV_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gNb = 0;
AT24FV_Gap gG[];
int    gM = 0, gOpen = 0;
double gStats[];
double gPrice = 0.0;
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::fvg_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

bool g_isOpen(const int k);

void DrawZones(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "zn");
   datetime tEnd = time[rates_total - 1] + PeriodSeconds() * 15;
   int shown = 0;
   for(int k = gM - 1; k >= 0 && shown < InpMaxZones; k--)
     {
      if(g_isOpen(k) == false) continue;
      shown++;
      string nm = PFX + "zn" + IntegerToString(gG[k].bar);
      color col = (gG[k].dir == 1) ? InpUpColor : InpDownColor;
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, time[base + gG[k].bar - 2], gG[k].top, tEnd, gG[k].bottom);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
      ObjectSetInteger(0, nm, OBJPROP_FILL, true);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string tx = nm + "t";
      ObjectCreate(0, tx, OBJ_TEXT, 0, tEnd, (gG[k].top + gG[k].bottom) / 2.0);
      ObjectSetString(0, tx, OBJPROP_TEXT, StringFormat("FVG %s%s", gG[k].dir == 1 ? "up" : "down", gG[k].touch >= 0 ? " (touched)" : ""));
      ObjectSetInteger(0, tx, OBJPROP_COLOR, gG[k].dir == 1 ? clrLimeGreen : clrTomato);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_LEFT);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
  }

bool g_isOpen(const int k) { return gG[k].fill < 0; }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 FVG ZONES", C'230,190,80', 10, true);
   //--- nearest open gap below and above the last close
   double below = 0.0, above = 0.0; int nOpen = 0;
   for(int k = 0; k < gM; k++)
     {
      if(!g_isOpen(k)) continue;
      nOpen++;
      double mid = (gG[k].top + gG[k].bottom) / 2.0;
      if(mid <= gPrice && (below == 0.0 || mid > below)) below = mid;
      if(mid > gPrice && (above == 0.0 || mid < above)) above = mid;
     }
   MakeLabel("t2", 70, 26, StringFormat("%d OPEN GAPS", nOpen), clrWhite, 11, true);
   MakeLabel("l1", 10, 66, StringFormat("Nearest open gap above: %s", above > 0.0 ? DoubleToString(above, Dg()) : "-"), clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("Nearest open gap below: %s", below > 0.0 ? DoubleToString(below, Dg()) : "-"), clrWhite, 9);
   MakeLabel("h1", 10, 108, StringFormat("Last %d bars: %d gaps (min %.1f ATR)", InpHistoryBars, (int)gStats[0], InpMinAtr), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("Revisited within %d bars: %.0f%%  (median %.0f bars)", InpWindow, gStats[1], gStats[3]), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Filled completely within %d bars: %.0f%%", InpWindow, gStats[2]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Control level, same distance: revisited %.0f%%", gStats[4]), clrWhite, 9);
   MakeLabel("s4", 10, 174, StringFormat("After a revisit, bounced 1 gap-height: %.0f%% (%d)", gStats[5], (int)gStats[6]), clrWhite, 9);
   MakeLabel("n1", 10, 196, "Gap = 3 bars, filled when price trades through it.", clrSlateGray, 8);
   MakeLabel("n2", 10, 210, "Revisit ~ control = a gap is not a magnet.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 FVG Zones");
   if(InpAtrLen < 5 || InpAtrLen > 60 || InpMinAtr < 0.0 || InpWindow < 5 || InpWindow > 500 || InpReact < 1)
     {
      Print("AT24 FVG Zones: ATR length 5-60, min gap >= 0, window 5-500, reaction bars >= 1.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gStats, 7);
   for(int z = 0; z < 7; z++) gStats[z] = 0.0;
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
      //--- closed bars only: gaps, fills and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      gNb = nb;
      double h[], l[], c[]; ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      gM = AT24FV_Find(nb, h, l, c, InpAtrLen, InpMinAtr, gG);
      AT24FV_Stats(nb, h, l, c, gG, gM, InpWindow, InpReact, gStats);
      gPrice = c[nb - 1];
      gOpen = 0;
      for(int k = 0; k < gM; k++) if(g_isOpen(k)) gOpen++;
      DrawZones(base, time, rates_total);
      if(InpAlertNew && gM > 0 && gG[gM - 1].bar == nb - 1 && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string msg = StringFormat("AT24 FVG Zones %s: new %s gap %s - %s", _Symbol, gG[gM - 1].dir == 1 ? "bullish" : "bearish", DoubleToString(gG[gM - 1].bottom, Dg()), DoubleToString(gG[gM - 1].top, Dg()));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      B0[0] = gOpen; B1[0] = gM > 0 ? gG[gM - 1].dir : 0.0; B2[0] = gM > 0 ? gG[gM - 1].top : 0.0; B3[0] = gM > 0 ? gG[gM - 1].bottom : 0.0;
      B4[0] = gM > 0 ? nb - 1 - gG[gM - 1].bar : -1.0;
     }
   UpdateDash();
   return rates_total;
  }
