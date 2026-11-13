//+------------------------------------------------------------------+
//| AT24 Absorption Map (MT5)                                        |
//| Where did heavy tick volume (effort) go almost nowhere (result)? |
//| Those bars become zones: fresh ones are drawn with entry / stop /|
//| target levels, and every past zone's first retest is scored on   |
//| this symbol's own history (count, hit rate, average R, luck test).|
//| Non-repainting: closed bars only. Not a promise of results.      |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Absorption Map - zones where heavy tick volume made little progress, with entry / stop / target levels and a scorecard of how the first retest of past zones played out on this symbol."
#property description "It places no trades. Results on past bars do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   0

#include "AT24_Pullback_Core.mqh"
#include "AT24_AB_Core.mqh"

#resource "ab_logo56.bmp"

input group "=== Absorption bars ==="
input double InpVolMult       = 1.5;    // Tick volume of the bar vs the average of the bars before it
input int    InpVolAvgBars    = 20;     // Bars in that average
input double InpMaxRangeAtr   = 1.0;    // The bar's range must be at most this many ATR (little progress)
input int    InpLookback      = 6;      // Bars before it that define the push
input double InpPushAtr       = 1.0;    // The push must be at least this many ATR (against the zone side)
input int    InpMaxAge        = 200;    // Bars a zone stays fresh without being touched
input group "=== Trade plan and scorecard ==="
input double InpStopBufAtr    = 0.25;   // Stop beyond the far edge of the zone (ATR)
input double InpRewardRisk    = 2.0;    // Target as a multiple of the stop distance
input int    InpMaxHold       = 40;     // Bars before a trade is closed at the market (timed exit)
input double InpCost          = 0.0;    // Round-turn cost in price units (0 = the current spread)
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Chart ==="
input int    InpDrawZones     = 3;      // Fresh zones drawn per side (0 = none)
input int    InpDrawTrades    = 8;      // Past retests drawn (0 = none)
input group "=== Alerts (bar close) ==="
input bool   InpAlertTouch    = false;  // Alert when price first touches a fresh zone
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[];
string PFX = "AT24AB_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24ZN_Zone gZ[];
int    gNz = 0;
AT24SP_Score gSc[3];                 // 0 demand, 1 supply, 2 all
datetime gTimes[];
double gC[], gAtr[];
int    gDem = -1, gSup = -1;         // nearest fresh demand zone below / supply zone above (indices in gZ)
int    gFresh = 0, gTouchedNow = -1;
double gCostUsed = 0.0;
datetime gBuiltBar = 0, gAlertBar = 0;
AT24SP_Setup gTd[], gTs[], gTa[];

#define DASH_W 410
#define DASH_H 342

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ab_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string VerdictOf(const AT24SP_Score &s, color &c)
  {
   if(s.n < 30) { c = clrSlateGray; return StringFormat("too few retests (%d of 30)", s.n); }
   if(s.avgR > 0.0 && s.pFlip < 0.05) { c = clrLimeGreen; return StringFormat("POSITIVE ON THIS HISTORY (p %.3f)", s.pFlip); }
   if(s.avgR < 0.0 && s.pFlip > 0.95) { c = clrTomato; return "NEGATIVE ON THIS HISTORY"; }
   c = clrGold; return StringFormat("NO EDGE SHOWN (p %.2f)", s.pFlip);
  }

string PlanTxt(const int zi, const double risk)
  {
   int dg = _Digits;
   double entry = gZ[zi].dir > 0 ? gZ[zi].top : gZ[zi].bottom;
   double sl = gZ[zi].dir > 0 ? gZ[zi].bottom - InpStopBufAtr * gZ[zi].atr : gZ[zi].top + InpStopBufAtr * gZ[zi].atr;
   double r = gZ[zi].dir * (entry - sl);
   double tp = entry + gZ[zi].dir * InpRewardRisk * r;
   return StringFormat("%s limit %s  stop %s  target %s", gZ[zi].dir > 0 ? "BUY" : "SELL", DoubleToString(entry, dg), DoubleToString(sl, dg), DoubleToString(tp, dg));
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 ABSORPTION MAP", C'230,190,80', 10, true);
   if(gBars < 500) { MakeLabel("t2", 70, 26, "LOADING HISTORY", clrSlateGray, 11, true); return; }
   double px = gC[gBars - 1];
   MakeLabel("t2", 70, 26, StringFormat("%d fresh absorption zones on %s", gFresh, _Symbol), gFresh > 0 ? clrWhite : clrSlateGray, 11, true);
   MakeLabel("t3", 70, 42, gTouchedNow >= 0 ? "A fresh zone was touched on the last closed bar" : "no zone touched on the last closed bar", gTouchedNow >= 0 ? clrGold : clrSilver, 8, gTouchedNow >= 0);
   MakeLabel("d0", 10, 66, "Nearest fresh zones", C'230,190,80', 8, true);
   if(gSup >= 0) { MakeLabel("d1", 10, 82, StringFormat("SUPPLY above: %.1f ATR away", (gZ[gSup].bottom - px) / gAtr[gBars - 1]), clrOrange, 8, true); MakeLabel("d2", 10, 96, PlanTxt(gSup, 0), clrWhite, 8); }
   else { MakeLabel("d1", 10, 82, "SUPPLY above: none fresh", clrSlateGray, 8); MakeLabel("d2", 10, 96, " ", clrWhite, 8); }
   if(gDem >= 0) { MakeLabel("d3", 10, 116, StringFormat("DEMAND below: %.1f ATR away", (px - gZ[gDem].top) / gAtr[gBars - 1]), clrDeepSkyBlue, 8, true); MakeLabel("d4", 10, 130, PlanTxt(gDem, 0), clrWhite, 8); }
   else { MakeLabel("d3", 10, 116, "DEMAND below: none fresh", clrSlateGray, 8); MakeLabel("d4", 10, 130, " ", clrWhite, 8); }
   MakeLabel("s0", 10, 156, "First retest of past absorption zones", C'230,190,80', 8, true);
   string nm[3] = {"Sellers absorbed (buy at the zone)", "Buyers absorbed (sell at the zone)", "All zones"};
   int y = 172;
   for(int k = 0; k < 3; k++)
     {
      color vc; string v = VerdictOf(gSc[k], vc); string id = IntegerToString(k);
      MakeLabel("a" + id, 10, y, nm[k], clrWhite, 8, true);
      MakeLabel("b" + id, 10, y + 13, StringFormat("%d retests  hit %.0f %%  average %+.2f R after cost  total %+.0f R", gSc[k].n, gSc[k].hitPct, gSc[k].avgR, gSc[k].sumR), clrSilver, 8);
      MakeLabel("c" + id, 10, y + 26, v, vc, 8, true);
      y += 44;
     }
   MakeLabel("n1", 10, 306, "Zones are known only after the heavy bar closed; only the", clrSlateGray, 8);
   MakeLabel("n2", 10, 319, "first retest counts. Past results do not predict future ones.", clrSlateGray, 8);
   MakeLabel("f1", 10, 333, "Research tool, not a signal or advice. algotraders24.ai", clrSlateGray, 7);
  }

void DrawZones()
  {
   ObjectsDeleteAll(0, PFX + "z");
   ObjectsDeleteAll(0, PFX + "t");
   if(gBars < 10) return;
   datetime tEnd = gTimes[gBars - 1] + (datetime)(PeriodSeconds() * 30);
   if(InpDrawZones > 0)
     {
      int shownD = 0, shownS = 0;
      for(int z = gNz - 1; z >= 0; z--)
        {
         if(gZ[z].touch >= 0 || gBars - 1 - gZ[z].idx > InpMaxAge) continue;
         bool dem = (gZ[z].dir > 0);
         if(dem && shownD >= InpDrawZones) continue;
         if(!dem && shownS >= InpDrawZones) continue;
         if(dem) shownD++; else shownS++;
         string nm = PFX + "z" + IntegerToString(z);
         ObjectCreate(0, nm, OBJ_RECTANGLE, 0, gTimes[gZ[z].idx], gZ[z].top, tEnd, gZ[z].bottom);
         ObjectSetInteger(0, nm, OBJPROP_COLOR, dem ? clrDeepSkyBlue : clrOrange);
         ObjectSetInteger(0, nm, OBJPROP_FILL, true); ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
         ObjectSetString(0, nm, OBJPROP_TEXT, dem ? "absorbed selling" : "absorbed buying");
        }
     }
   if(InpDrawTrades > 0)
     {
      int drawn = 0;
      for(int k = ArraySize(gTa) - 1; k >= 0 && drawn < InpDrawTrades; k--, drawn++)
        {
         AT24SP_Setup s = gTa[k];
         datetime t1 = (s.exitIdx >= 0 && s.exitIdx < gBars) ? gTimes[s.exitIdx] : gTimes[gBars - 1];
         color c = (s.result == 1) ? clrLimeGreen : ((s.result == -1) ? clrTomato : ((s.result == 0) ? clrGold : clrWhite));
         string nm = PFX + "t" + IntegerToString(k);
         ObjectCreate(0, nm, OBJ_TREND, 0, gTimes[s.idx], s.entry, t1, (s.result == 1) ? s.tp : ((s.result == -1) ? s.sl : s.entry));
         ObjectSetInteger(0, nm, OBJPROP_COLOR, c); ObjectSetInteger(0, nm, OBJPROP_WIDTH, 2); ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DOT); ObjectSetInteger(0, nm, OBJPROP_BACK, true);
         ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false); ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
        }
     }
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, _Period, 1, MathMax(InpHistoryBars, 1000), rr);
   if(n < 500) { gBars = MathMax(n, 0); return false; }
   double o[], h[], l[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(gC, n); ArrayResize(gAtr, n); ArrayResize(gTimes, n);
   for(int i = 0; i < n; i++) { o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; gC[i] = rr[i].close; gTimes[i] = rr[i].time; }
   AT24TP_Atr(n, h, l, gC, 14, gAtr);
   long tv[]; ArrayResize(tv, n); for(int k = 0; k < n; k++) tv[k] = rr[k].tick_volume;
   gNz = AT24AB_Detect(n, o, h, l, gC, tv, gAtr, InpVolMult, InpVolAvgBars, InpMaxRangeAtr, InpLookback, InpPushAtr, gZ);
   AT24ZN_Touches(n, h, l, gZ, gNz, InpMaxAge);
   double cost = InpCost > 0.0 ? InpCost : (SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID));
   if(cost < 0.0) cost = 0.0;
   gCostUsed = cost;
   int c0 = AT24ZN_Trades(n, o, h, l, gC, gZ, gNz, 1, InpStopBufAtr, InpRewardRisk, InpMaxHold, cost, gTd);
   int c1 = AT24ZN_Trades(n, o, h, l, gC, gZ, gNz, -1, InpStopBufAtr, InpRewardRisk, InpMaxHold, cost, gTs);
   int c2 = AT24ZN_Trades(n, o, h, l, gC, gZ, gNz, 0, InpStopBufAtr, InpRewardRisk, InpMaxHold, cost, gTa);
   AT24SP_ScoreOf(gTd, c0, 20261111, gSc[0]); AT24SP_ScoreOf(gTs, c1, 20261111, gSc[1]); AT24SP_ScoreOf(gTa, c2, 20261111, gSc[2]);
   gBars = n;
   //--- fresh zones, the nearest on each side of the last close, and a touch on the last closed bar
   double px = gC[n - 1]; gDem = -1; gSup = -1; gFresh = 0; gTouchedNow = -1;
   double bestD = 1e300, bestS = 1e300;
   for(int z = 0; z < gNz; z++)
     {
      if(gZ[z].touch == n - 1) gTouchedNow = z;
      if(gZ[z].touch >= 0 || n - 1 - gZ[z].idx > InpMaxAge) continue;
      gFresh++;
      if(gZ[z].dir > 0 && gZ[z].top < px && px - gZ[z].top < bestD) { bestD = px - gZ[z].top; gDem = z; }
      if(gZ[z].dir < 0 && gZ[z].bottom > px && gZ[z].bottom - px < bestS) { bestS = gZ[z].bottom - px; gSup = z; }
     }
   B0[0] = gFresh; B1[0] = gSc[0].avgR; B2[0] = gSc[1].avgR;
   DrawZones();
   return true;
  }

void Refresh()
  {
   datetime bar = iTime(_Symbol, _Period, 0);
   if(gBuiltBar != bar) { if(Rebuild()) gBuiltBar = bar; }
   if(gBuiltBar == bar && gTouchedNow >= 0 && InpAlertTouch && gAlertBar != bar)
     {
      gAlertBar = bar;
      string msg = StringFormat("AT24 Absorption Map %s: price touched a fresh %s absorption zone (%s - %s)", _Symbol, gZ[gTouchedNow].dir > 0 ? "DEMAND" : "SUPPLY", DoubleToString(gZ[gTouchedNow].bottom, _Digits), DoubleToString(gZ[gTouchedNow].top, _Digits));
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Absorption Map");
   if(InpVolMult < 1.0 || InpVolMult > 6.0 || InpVolAvgBars < 5 || InpVolAvgBars > 200 || InpMaxRangeAtr < 0.2 || InpMaxRangeAtr > 3.0 || InpLookback < 2 || InpLookback > 50 || InpPushAtr < 0.2 || InpPushAtr > 6.0
      || InpMaxAge < 20 || InpMaxAge > 1000 || InpStopBufAtr < 0.0 || InpStopBufAtr > 3.0 || InpRewardRisk < 0.3 || InpRewardRisk > 10.0 || InpMaxHold < 5 || InpMaxHold > 500 || InpCost < 0.0 || InpDrawZones < 0 || InpDrawTrades < 0)
     {
      Print("AT24 Absorption Map: check the inputs (volume multiple 1-6, average 5-200 bars, range 0.2-3 ATR, lookback 2-50, push 0.2-6 ATR, age 20-1000, reward:risk 0.3-10, hold 5-500).");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int k = 0; k < 3; k++) gSc[k].n = 0;
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
