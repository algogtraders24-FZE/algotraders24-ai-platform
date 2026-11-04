//+------------------------------------------------------------------+
//| AT24 Expected Range (MT5)                                        |
//| How much of today's usual range is already used - and how often  |
//| days really exceeded it on YOUR symbol.                          |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Expected Range - usual daily range, range used so far, projected day high/low + real statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_ER_Core.mqh"

#resource "er_logo56.bmp"

input group "=== Expected range ==="
input int    InpLookback      = 14;     // Previous complete days averaged
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Look ==="
input int    InpLineWidth     = 2;      // Line width of the projected high / low
input color  InpHighColor     = clrTomato;      // Projected day high
input color  InpLowColor      = clrLimeGreen;   // Projected day low
input color  InpOpenColor     = clrSilver;      // Day open
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertUsed     = false;  // Alert when today's range reaches 100 % of expected
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24ER_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
AT24ER_Day gD[];
int    gN = 0;
double gStats[];
double gUsed = 0.0;
datetime gAlertDay = 0;

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::er_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

void Line(const string nm, const datetime t1, const datetime t2, const double p, const color col, const int style, const int width, const string txt)
  {
   ObjectCreate(0, nm, OBJ_TREND, 0, t1, p, t2, p);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, style);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
   string tx = nm + "t";
   ObjectCreate(0, tx, OBJ_TEXT, 0, t2, p);
   ObjectSetString(0, tx, OBJPROP_TEXT, txt + "  " + DoubleToString(p, Dg()));
   ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
   ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
   ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
  }

void DrawLevels(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "lv");
   if(gN < 1 || gD[gN - 1].exp <= 0.0) return;
   AT24ER_Day d = gD[gN - 1];
   datetime t1 = time[base + d.first];
   datetime t2 = time[rates_total - 1] + PeriodSeconds() * 14;
   double e = d.exp;
   Line(PFX + "lvo", t1, t2, d.open, InpOpenColor, STYLE_SOLID, 1, "day open");
   Line(PFX + "lvh", t1, t2, d.low + e, InpHighColor, STYLE_SOLID, InpLineWidth, "expected high");
   Line(PFX + "lvl", t1, t2, d.high - e, InpLowColor, STYLE_SOLID, InpLineWidth, "expected low");
  }

void UpdateDash(const double expPts)
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 EXPECTED RANGE", C'230,190,80', 10, true);
   if(gN >= 1 && gD[gN - 1].exp > 0.0)
     {
      AT24ER_Day d = gD[gN - 1];
      string st = gUsed < 0.5 ? "QUIET" : (gUsed < 1.0 ? "NORMAL" : (gUsed < 1.5 ? "STRETCHED" : "EXTREME"));
      color sc = gUsed < 0.5 ? clrSlateGray : (gUsed < 1.0 ? clrLimeGreen : (gUsed < 1.5 ? clrGold : clrTomato));
      MakeLabel("t2", 70, 26, StringFormat("TODAY: %s  (%.0f%% used)", st, gUsed * 100.0), sc, 11, true);
      MakeLabel("l1", 10, 66, StringFormat("Usual range %s   range so far %s", DoubleToString(d.exp, Dg()), DoubleToString(d.high - d.low, Dg())), clrWhite, 9);
      MakeLabel("l2", 10, 82, StringFormat("Projected high %s   low %s", DoubleToString(d.low + d.exp, Dg()), DoubleToString(d.high - d.exp, Dg())), clrWhite, 9);
     }
   else
     {
      MakeLabel("t2", 70, 26, "NOT ENOUGH DAYS YET", clrSlateGray, 11, true);
      MakeLabel("l1", 10, 66, "Needs history of the previous complete days.", clrSlateGray, 9);
     }
   MakeLabel("h1", 10, 108, StringFormat("Last %d complete days (avg of %d prior days)", (int)gStats[0], InpLookback), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("Median day = %.0f%% of the usual range", gStats[1] * 100.0), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Days over 100%%: %.0f%%   over 150%%: %.0f%%", gStats[2], gStats[3]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Reached 100%% (%d days): ended >= 125%% %.0f%%, median %.0f%%", (int)gStats[4], gStats[5], gStats[6] * 100.0), clrWhite, 9);
   MakeLabel("s4", 10, 174, StringFormat("Close moved >= half the range from open: %.0f%%", gStats[7]), clrWhite, 9);
   MakeLabel("n1", 10, 196, "Day = server-time day. Usual range = mean of prior days.", clrSlateGray, 8);
   MakeLabel("n2", 10, 210, "A day often exceeds it: 100% is a mark, not a wall.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Expected Range");
   if(InpLookback < 3 || InpLookback > 60)
     {
      Print("AT24 Expected Range: lookback must be 3-60 days.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(PeriodSeconds() > 4 * 3600)
     {
      Print("AT24 Expected Range: use a chart of H4 or lower (it builds days from intraday bars).");
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
   if(rates_total < 200) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: days, expectations and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      datetime t[]; double o[], h[], l[], c[];
      ArrayResize(t, nb); ArrayResize(o, nb); ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { t[q] = time[base + q]; o[q] = open[base + q]; h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      gN = AT24ER_Days(nb, t, o, h, l, c, InpLookback, gD);
      AT24ER_Stats(gD, gN, gStats);
      DrawLevels(base, time, rates_total);
      gUsed = (gN >= 1 && gD[gN - 1].exp > 0.0) ? (gD[gN - 1].high - gD[gN - 1].low) / gD[gN - 1].exp : 0.0;
      if(InpAlertUsed && gN >= 1 && gUsed >= 1.0 && gD[gN - 1].first != 0 && (datetime)(((long)t[nb - 1] / 86400) * 86400) != gAlertDay)
        {
         gAlertDay = (datetime)(((long)t[nb - 1] / 86400) * 86400);
         string msg = StringFormat("AT24 Expected Range %s: today's range has reached %.0f%% of the usual range", _Symbol, gUsed * 100.0);
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      if(gN >= 1)
        {
         B0[0] = gD[gN - 1].exp; B1[0] = gUsed; B2[0] = gD[gN - 1].exp > 0.0 ? gD[gN - 1].low + gD[gN - 1].exp : 0.0;
         B3[0] = gD[gN - 1].exp > 0.0 ? gD[gN - 1].high - gD[gN - 1].exp : 0.0; B4[0] = gD[gN - 1].open;
        }
     }
   UpdateDash(0.0);
   return rates_total;
  }
