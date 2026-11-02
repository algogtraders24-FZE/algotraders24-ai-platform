//+------------------------------------------------------------------+
//| AT24 Regime Pulse (MT4)                                          |
//| Know WHEN to trade, not just where.                              |
//| Trend quality + volatility rank + spread cost + session.         |
//| A context tool. It does not give buy/sell signals.               |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Regime Pulse - trend quality, volatility rank, spread cost and session in one panel."
#property description "Context tool. Not a signal. Past conditions do not predict future results."
#property indicator_separate_window
#property indicator_buffers 7
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_color1  clrLimeGreen
#property indicator_color2  clrDeepSkyBlue
#property indicator_color3  clrOrange
#property indicator_color4  clrTomato
#property indicator_color5  clrSlateGray
#property indicator_color6  clrGold
#property indicator_color7  clrGold
#property indicator_level1  35
#property indicator_level2  20
#property indicator_levelcolor clrDimGray
#property indicator_levelstyle STYLE_DOT

#include "AT24_RegimePulse_Core.mqh"

#resource "logo56.bmp"

// === Measurements ===
input int    InpERPeriod      = 20;     // Efficiency Ratio period (bars)
input int    InpATRPeriod     = 14;     // ATR period
input int    InpLookback      = 500;    // Volatility rank lookback (bars)
input int    InpMaxBars       = 5000;   // History bars to calculate (0 = all, slow on big charts)
// === Regime thresholds ===
input double InpERTrend       = 0.35;   // ER at/above = trending
input double InpERRange       = 0.20;   // ER at/below = ranging
input double InpPctHigh       = 70.0;   // ATR rank at/above = high volatility
input double InpPctQuiet      = 25.0;   // ATR rank at/below = quiet
// === Cost and session ===
input double InpMaxSpreadATR  = 0.15;   // Warn when spread / ATR is above this
input int    InpGMTOffsetSec  = 0;      // Added to TimeGMT() for session labels (0 = real GMT)
// === Dashboard ===
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
// === Alerts (at bar close only) ===
input bool   InpAlertRegime   = false;  // Alert when the regime changes
input bool   InpAlertPush     = false;  // Also send push notification

double B1[], B2[], B3[], B4[], B5[], B6[], BufPct[];
double gATR[], gER[], gPct[];
double gHi[], gLo[], gCl[];
datetime gTm[];
int    gBase = 0;
int    gLastRegime = RP_NONE;
datetime gLastAlertBar = 0;
bool   gDash = false;
string PFX = "AT24RP_";

//--- dashboard geometry
#define DASH_W 270
#define DASH_H 150

color RegimeColor(const int r)
  {
   switch(r)
     {
      case RP_TREND:  return clrLimeGreen;
      case RP_STRONG: return clrDeepSkyBlue;
      case RP_RANGE:  return clrOrange;
      case RP_CHOP:   return clrTomato;
      case RP_QUIET:  return clrSlateGray;
      case RP_MIXED:  return clrGold;
     }
   return clrDimGray;
  }

int gBaseX = 0, gBaseY = 0;

// All dash objects use the left-upper corner; right/lower corners are resolved from the chart size.
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

void BuildDashFrame()
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void UpdateDash(const int regime, const double er, const double pct, const double atrPts, const double spreadPts)
  {
   if(!gDash) return;
   BuildDashFrame();
   double costPct = (atrPts > 0.0) ? 100.0 * spreadPts / atrPts : 0.0;
   bool costBad = (atrPts > 0.0 && spreadPts / atrPts > InpMaxSpreadATR);
   MqlDateTime g;
   TimeToStruct(TimeGMT() + InpGMTOffsetSec, g);
   // text offset to the right of the 56px logo (left corners) or from the right edge (right corners)
   int tx = 70;
   MakeLabel("t1", tx, 6, "AT24 REGIME PULSE", C'230,190,80', 10, true);
   MakeLabel("t2", tx, 26, AT24RP_RegimeName(regime), RegimeColor(regime), 11, true);
   MakeLabel("l1", 10, 68, StringFormat("Trend quality (ER)   %.2f", er), clrWhite, 9);
   MakeLabel("l2", 10, 84, StringFormat("Volatility rank      %.0f / 100", pct), clrWhite, 9);
   MakeLabel("l3", 10, 100, StringFormat("Spread / ATR        %.1f%%  %s", costPct, costBad ? "HIGH COST" : "ok"), costBad ? clrTomato : clrWhite, 9);
   MakeLabel("l4", 10, 116, "Session  " + AT24RP_Session(g.hour, g.min), clrWhite, 9);
   MakeLabel("ft", 10, 132, "Context tool. Not a signal. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B1); SetIndexBuffer(1, B2); SetIndexBuffer(2, B3);
   SetIndexBuffer(3, B4); SetIndexBuffer(4, B5); SetIndexBuffer(5, B6);
   SetIndexBuffer(6, BufPct);
   for(int k = 0; k < 6; k++) { SetIndexStyle(k, DRAW_HISTOGRAM, STYLE_SOLID, 3); SetIndexEmptyValue(k, EMPTY_VALUE); }
   SetIndexStyle(6, DRAW_LINE, STYLE_SOLID, 1); SetIndexEmptyValue(6, EMPTY_VALUE);
   SetIndexLabel(0, "TREND"); SetIndexLabel(1, "STRONG TREND"); SetIndexLabel(2, "RANGE");
   SetIndexLabel(3, "CHOP"); SetIndexLabel(4, "QUIET"); SetIndexLabel(5, "MIXED");
   SetIndexLabel(6, "Volatility rank (ATR pct)");
   IndicatorShortName("AT24 Regime Pulse");
   IndicatorDigits(1);
   if(InpERTrend <= InpERRange || InpPctHigh <= InpPctQuiet)
     {
      Print("AT24 Regime Pulse: thresholds invalid (trend must be above range, high above quiet).");
      return INIT_PARAMETERS_INCORRECT;
     }
   gDash = InpShowDash && (!IsTesting() || (InpDashInTester && IsVisualMode()));
   if(gDash) BuildDashFrame();
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildDashFrame();
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, PFX);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < InpATRPeriod + 25) return 0;
   if(ArraySize(gATR) != rates_total)
     {
      ArrayResize(gATR, rates_total);
      ArrayResize(gER, rates_total);
      ArrayResize(gPct, rates_total);
      ArrayResize(gHi, rates_total);
      ArrayResize(gLo, rates_total);
      ArrayResize(gCl, rates_total);
      ArrayResize(gTm, rates_total);
     }
   // work in chronological order
   ArraySetAsSeries(B1, false); ArraySetAsSeries(B2, false); ArraySetAsSeries(B3, false); ArraySetAsSeries(B4, false);
   ArraySetAsSeries(B5, false); ArraySetAsSeries(B6, false); ArraySetAsSeries(BufPct, false);

   if(prev_calculated == 0) gBase = (InpMaxBars > 0) ? MathMax(0, rates_total - InpMaxBars) : 0;
   //--- MQL4 may hand the input arrays over newest-first; work on chronological copies of the window we use
   bool ser = ArrayGetAsSeries(close);
   int cp = MathMax(0, MathMax(gBase, rates_total - InpMaxBars - InpLookback - 50));
   if(InpMaxBars == 0) cp = 0;
   for(int k = MathMin(cp, MathMax(0, prev_calculated - 3)); k < rates_total; k++)
     {
      int sx = ser ? rates_total - 1 - k : k;
      gHi[k] = high[sx]; gLo[k] = low[sx]; gCl[k] = close[sx]; gTm[k] = time[sx];
     }
   int first = (prev_calculated > 1) ? prev_calculated - 1 : 0;
   // the ATR recursion needs the previous value to be intact; on a full recalculation start at 0
   if(first == 0)
     {
      ArrayInitialize(B1, EMPTY_VALUE); ArrayInitialize(B2, EMPTY_VALUE); ArrayInitialize(B3, EMPTY_VALUE);
      ArrayInitialize(B4, EMPTY_VALUE); ArrayInitialize(B5, EMPTY_VALUE); ArrayInitialize(B6, EMPTY_VALUE);
      ArrayInitialize(BufPct, EMPTY_VALUE);
     }
   if(!AT24RP_Calc(rates_total, first, gBase, gHi, gLo, gCl, InpERPeriod, InpATRPeriod, InpLookback, gATR, gER, gPct))
      return 0;

   for(int i = MathMax(first, gBase); i < rates_total; i++)
     {
      B1[i] = B2[i] = B3[i] = B4[i] = B5[i] = B6[i] = EMPTY_VALUE;
      if(gER[i] != EMPTY_VALUE)
        {
         double v = gER[i] * 100.0;
         double p = (gPct[i] == EMPTY_VALUE) ? -1.0 : gPct[i];
         int r = AT24RP_Classify(gER[i], p, InpERTrend, InpERRange, InpPctHigh, InpPctQuiet);
         switch(r)
           {
            case RP_TREND:  B1[i] = v; break;
            case RP_STRONG: B2[i] = v; break;
            case RP_RANGE:  B3[i] = v; break;
            case RP_CHOP:   B4[i] = v; break;
            case RP_QUIET:  B5[i] = v; break;
            case RP_MIXED:  B6[i] = v; break;
           }
        }
      BufPct[i] = gPct[i];
     }

   //--- latest CLOSED bar drives alerts, the forming bar drives the dashboard
   int last = rates_total - 1;
   int closed = rates_total - 2;
   if(closed > 0 && gER[closed] != EMPTY_VALUE && gPct[closed] != EMPTY_VALUE)
     {
      int rc = AT24RP_Classify(gER[closed], gPct[closed], InpERTrend, InpERRange, InpPctHigh, InpPctQuiet);
      if(InpAlertRegime && rc != gLastRegime && gTm[closed] != gLastAlertBar && gLastRegime != RP_NONE)
        {
         string msg = StringFormat("AT24 Regime Pulse %s %s: %s -> %s (ER %.2f, vol rank %.0f)", _Symbol, EnumToString((ENUM_TIMEFRAMES)_Period),
                                   AT24RP_RegimeName(gLastRegime), AT24RP_RegimeName(rc), gER[closed], gPct[closed]);
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
         gLastAlertBar = gTm[closed];
        }
      gLastRegime = rc;
     }

   if(gDash && gER[last] != EMPTY_VALUE && gPct[last] != EMPTY_VALUE)
     {
      int rl = AT24RP_Classify(gER[last], gPct[last], InpERTrend, InpERRange, InpPctHigh, InpPctQuiet);
      double spreadPts = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) * _Point;
      UpdateDash(rl, gER[last], gPct[last], gATR[last], spreadPts);
     }
   return rates_total;
  }
