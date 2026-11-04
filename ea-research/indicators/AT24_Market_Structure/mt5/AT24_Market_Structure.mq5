//+------------------------------------------------------------------+
//| AT24 Market Structure (MT5)                                      |
//| BOS (break of structure) and CHoCH (change of character) from    |
//| confirmed swings - and what price really did after them.        |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Market Structure - BOS / CHoCH on confirmed swings + real follow-through statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_MS_Core.mqh"

#resource "ms_logo56.bmp"

input group "=== Structure ==="
input int    InpSwingBars     = 5;      // Bars each side to confirm a swing
input int    InpFwdBars       = 20;     // Bars after a break used for the statistics
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Look ==="
input int    InpEvents        = 10;     // Breaks drawn
input int    InpLineWidth     = 2;      // Line width
input color  InpUpColor       = clrLimeGreen;  // Break up (BOS)
input color  InpDownColor     = clrTomato;     // Break down (BOS)
input color  InpChochColor    = clrGold;       // Change of character (CHoCH)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertChoch    = false;  // Alert on a change of character
input bool   InpAlertBos      = false;  // Alert on a break of structure
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24MS_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
AT24MS_Event gEv[];
int    gM = 0, gTrend = 0, gHiBar = -1, gLoBar = -1;
double gHiPx = 0.0, gLoPx = 0.0;
double gStats[];
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ms_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

color EvColor(const AT24MS_Event &e) { return (e.type == 1) ? InpChochColor : (e.dir == 1 ? InpUpColor : InpDownColor); }

void DrawEvents(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "ev");
   ObjectsDeleteAll(0, PFX + "op");
   int shown = 0;
   for(int i = gM - 1; i >= 0 && shown < InpEvents; i--, shown++)
     {
      string nm = PFX + "ev" + IntegerToString(i);
      datetime t1 = time[base + gEv[i].lvlBar];
      datetime t2 = time[base + gEv[i].bar];
      color col = EvColor(gEv[i]);
      ObjectCreate(0, nm, OBJ_TREND, 0, t1, gEv[i].level, t2, gEv[i].level);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
      ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_SOLID);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, InpLineWidth);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string tx = nm + "t";
      datetime tm = t1 + (t2 - t1) / 2;
      ObjectCreate(0, tx, OBJ_TEXT, 0, tm, gEv[i].level);
      ObjectSetString(0, tx, OBJPROP_TEXT, gEv[i].type == 1 ? "CHoCH" : "BOS");
      ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, gEv[i].dir == 1 ? ANCHOR_LOWER : ANCHOR_UPPER);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
   //--- latest unbroken swing high / low: the levels a break would have to take
   datetime tEnd = time[rates_total - 1] + PeriodSeconds() * 15;
   for(int s = 0; s < 2; s++)
     {
      int bar = (s == 0) ? gHiBar : gLoBar;
      if(bar < 0) continue;
      double px = (s == 0) ? gHiPx : gLoPx;
      string nm = PFX + "op" + IntegerToString(s);
      ObjectCreate(0, nm, OBJ_TREND, 0, time[base + bar], px, tEnd, px);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, clrSilver);
      ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string tx = nm + "t";
      ObjectCreate(0, tx, OBJ_TEXT, 0, tEnd, px);
      ObjectSetString(0, tx, OBJPROP_TEXT, StringFormat("%s %s", s == 0 ? "swing high" : "swing low", DoubleToString(px, Dg())));
      ObjectSetInteger(0, tx, OBJPROP_COLOR, clrSilver);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_LEFT);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
  }

void UpdateDash(const int nb)
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 MARKET STRUCTURE", C'230,190,80', 10, true);
   string ts = (gTrend == 1) ? "STRUCTURE: UP" : (gTrend == -1 ? "STRUCTURE: DOWN" : "STRUCTURE: NOT SET");
   MakeLabel("t2", 70, 26, ts, gTrend == 1 ? InpUpColor : (gTrend == -1 ? InpDownColor : clrSlateGray), 11, true);
   if(gM > 0)
     {
      AT24MS_Event e = gEv[gM - 1];
      MakeLabel("l1", 10, 66, StringFormat("Last: %s %s at %s, %d bars ago", e.type == 1 ? "CHoCH" : "BOS", e.dir == 1 ? "up" : "down", DoubleToString(e.level, Dg()), nb - 1 - e.bar), clrWhite, 9);
     }
   else
      MakeLabel("l1", 10, 66, "No break yet.", clrSlateGray, 9);
   MakeLabel("l2", 10, 82, StringFormat("Swing high %s   Swing low %s", gHiBar >= 0 ? DoubleToString(gHiPx, Dg()) : "-", gLoBar >= 0 ? DoubleToString(gLoPx, Dg()) : "-"), clrWhite, 9);
   MakeLabel("h1", 10, 108, StringFormat("Last %d bars: %d BOS, %d CHoCH (swing %d bars)", InpHistoryBars, (int)gStats[0], (int)gStats[2], InpSwingBars), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("%d bars after a BOS: kept going %.0f%% (%d)", InpFwdBars, gStats[1], (int)gStats[5]), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("%d bars after a CHoCH: kept going %.0f%% (%d)", InpFwdBars, gStats[3], (int)gStats[6]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Any bar: close %d bars later higher %.0f%%", InpFwdBars, gStats[4]), clrWhite, 9);
   MakeLabel("n1", 10, 184, "Break = bar CLOSE beyond the last confirmed swing.", clrSlateGray, 8);
   MakeLabel("n2", 10, 198, "~50% 'kept going' = no better than any other bar.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Market Structure");
   if(InpSwingBars < 2 || InpSwingBars > 30 || InpFwdBars < 1 || InpFwdBars > 200)
     {
      Print("AT24 Market Structure: swing bars 2-30, statistics bars 1-200.");
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
   static int nbLast = 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: swings, breaks and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      nbLast = nb;
      double h[], l[], c[]; ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      gM = AT24MS_Scan(nb, h, l, c, InpSwingBars, gEv, gTrend, gHiPx, gHiBar, gLoPx, gLoBar);
      AT24MS_Stats(nb, c, gEv, gM, InpFwdBars, gStats);
      DrawEvents(base, time, rates_total);
      if(gM > 0 && gEv[gM - 1].bar == nb - 1 && time[base + nb - 1] != gAlertBar)
        {
         bool choch = (gEv[gM - 1].type == 1);
         if((choch && InpAlertChoch) || (!choch && InpAlertBos))
           {
            gAlertBar = time[base + nb - 1];
            string msg = StringFormat("AT24 Market Structure %s: %s %s at %s", _Symbol, choch ? "CHoCH" : "BOS", gEv[gM - 1].dir == 1 ? "up" : "down", DoubleToString(gEv[gM - 1].level, Dg()));
            Alert(msg);
            if(InpAlertPush) SendNotification(msg);
           }
        }
      B0[0] = gTrend; B1[0] = gHiBar >= 0 ? gHiPx : 0.0; B2[0] = gLoBar >= 0 ? gLoPx : 0.0;
      B3[0] = gM > 0 ? (gEv[gM - 1].type == 1 ? 2.0 : 1.0) * gEv[gM - 1].dir : 0.0;
      B4[0] = gM > 0 ? nb - 1 - gEv[gM - 1].bar : -1.0;
     }
   UpdateDash(nbLast);
   return rates_total;
  }
