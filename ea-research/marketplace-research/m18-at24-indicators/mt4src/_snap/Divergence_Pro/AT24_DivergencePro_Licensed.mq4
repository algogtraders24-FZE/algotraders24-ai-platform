//+------------------------------------------------------------------+
//| AT24 Divergence Pro (MT5)                                        |
//| RSI divergences between CONFIRMED swing points, drawn on the     |
//| chart with entry / stop / target levels, and every past          |
//| divergence scored on this symbol's own history (count, hit rate, |
//| average R after cost, luck test). Non-repainting: a swing point  |
//| is used only after the bars to its right have closed.            |
//| Not a promise of results.                                        |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#property version   "1.00"
#property description "AT24 Divergence Pro - RSI divergences on confirmed swing points with entry / stop / target levels and a scorecard of past divergences on this symbol."
#property description "It places no trades. Results on past bars do not predict future results. Not financial advice."

#include "AT24_Pullback_Core.mqh"
#include "AT24_DV_Core.mqh"

#define AT24_PRODUCT_ID "DIVERGENCE-PRO-MT4"
#include "AT24_LicenseGate.mqh"

#resource "dv_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input bool InpSaveSnapshot = true;  // Save one chart screenshot to MQL4/Files a few seconds after loading
input string grp1_ = "=== Divergence ===";
input int    InpRsiPeriod     = 14;     // RSI period
input int    InpSwingBars     = 5;      // Bars on each side that confirm a swing point
input int    InpMinSep        = 6;      // Fewest bars between the two swings
input int    InpMaxSep        = 60;     // Most bars between the two swings
input double InpMinDiff       = 2.0;    // Smallest RSI difference between the two swings (points)
input string grp2_ = "=== Trade plan and scorecard ===";
input double InpStopBufAtr    = 0.25;   // Stop beyond the swing extreme (ATR)
input double InpMaxRiskAtr    = 4.0;    // Skip when the stop would be further than this (ATR)
input double InpRewardRisk    = 2.0;    // Target as a multiple of the stop distance
input int    InpMaxHold       = 40;     // Bars before a trade is closed at the market (timed exit)
input double InpCost          = 0.0;    // Round-turn cost in price units (0 = the current spread)
input int    InpHistoryBars   = 8000;   // Bars analysed
input string grp3_ = "=== Chart ===";
input int    InpDrawDivs      = 10;     // Draw the last N divergences (0 = none)
input string grp4_ = "=== Alerts (bar close) ===";
input bool   InpAlertNew      = false;  // Alert when a new divergence is confirmed
input bool   InpAlertPush     = false;  // Also send a push notification
input string grp5_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[1], B1[1], B2[1];
string PFX = "AT24DV_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24DV_Ev gE[];
int    gNe = 0;
AT24SP_Setup gTd[], gTs[], gTa[];
AT24SP_Score gSc[3];
datetime gTimes[];
double gH[], gL[], gC[], gAtr[];
int    gLive = -1;                           // event confirmed on the last closed bar
double gLiveEntry = 0.0, gLiveSl = 0.0, gLiveTp = 0.0;
bool   gLiveOk = false;
datetime gBuiltBar = 0, gAlertBar = 0;

#define DASH_W 410
#define DASH_H 330

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::dv_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string VerdictOf(const AT24SP_Score &s, color &c)
  {
   if(s.n < 30) { c = clrSlateGray; return StringFormat("too few divergences (%d of 30)", s.n); }
   if(s.avgR > 0.0 && s.pFlip < 0.05) { c = clrLimeGreen; return StringFormat("POSITIVE ON THIS HISTORY (p %.3f)", s.pFlip); }
   if(s.avgR < 0.0 && s.pFlip > 0.95) { c = clrTomato; return "NEGATIVE ON THIS HISTORY"; }
   c = clrGold; return StringFormat("NO EDGE SHOWN (p %.2f)", s.pFlip);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 DIVERGENCE PRO", C'230,190,80', 10, true);
   if(gBars < 500) { MakeLabel("t2", 70, 26, "LOADING HISTORY", clrSlateGray, 11, true); return; }
   int dg = _Digits;
   if(gLive >= 0)
     {
      int d = gE[gLive].dir;
      MakeLabel("t2", 70, 26, StringFormat("%s divergence confirmed", d > 0 ? "BULLISH" : "BEARISH"), d > 0 ? clrLimeGreen : clrTomato, 11, true);
      if(gLiveOk) MakeLabel("t3", 70, 42, StringFormat("entry ~%s  stop %s  target %s  (R:R %.1f)", DoubleToString(gLiveEntry, dg), DoubleToString(gLiveSl, dg), DoubleToString(gLiveTp, dg), InpRewardRisk), clrWhite, 8, true);
      else MakeLabel("t3", 70, 42, "stop would be too far or on the wrong side: skipped", clrSilver, 8);
     }
   else
     {
      MakeLabel("t2", 70, 26, "NO DIVERGENCE ON THE LAST CLOSED BAR", clrSlateGray, 10, true);
      MakeLabel("t3", 70, 42, StringFormat("%s, RSI %d, swings %d bars each side, %d divergences found", _Symbol, InpRsiPeriod, InpSwingBars, gNe), clrSilver, 8);
     }
   MakeLabel("s0", 10, 70, "Past divergences on this symbol (one trade at a time)", C'230,190,80', 8, true);
   string nm[3] = {"Bullish (buy)", "Bearish (sell)", "All"};
   int y = 88;
   for(int k = 0; k < 3; k++)
     {
      color vc; string v = VerdictOf(gSc[k], vc); string id = IntegerToString(k);
      MakeLabel("a" + id, 10, y, nm[k], clrWhite, 8, true);
      MakeLabel("b" + id, 10, y + 13, StringFormat("%d trades  hit %.0f %%  average %+.2f R after cost  total %+.0f R", gSc[k].n, gSc[k].hitPct, gSc[k].avgR, gSc[k].sumR), clrSilver, 8);
      MakeLabel("c" + id, 10, y + 26, v, vc, 8, true);
      y += 46;
     }
   MakeLabel("n1", 10, 232, "A swing point counts only after the bars to its right", clrSlateGray, 8);
   MakeLabel("n2", 10, 245, "have closed (no repainting); the signal comes with that", clrSlateGray, 8);
   MakeLabel("n3", 10, 258, "delay. Stop beyond the swing extreme, entry next open.", clrSlateGray, 8);
   MakeLabel("n4", 10, 271, "Past results do not predict future results.", clrSlateGray, 8);
   MakeLabel("f1", 10, 300, StringFormat("%d bars analysed, closed bars only. algotraders24.ai", gBars), clrSlateGray, 7);
   MakeLabel("f2", 10, 312, "Research tool, not a signal or advice.", clrSlateGray, 7);
  }

void DrawDivs()
  {
   ObjectsDeleteAll(0, PFX + "v");
   if(InpDrawDivs <= 0 || gBars < 10) return;
   int from = MathMax(0, gNe - InpDrawDivs);
   for(int e = from; e < gNe; e++)
     {
      bool bull = gE[e].dir > 0;
      string nm = PFX + "v" + IntegerToString(e);
      ObjectCreate(0, nm, OBJ_TREND, 0, gTimes[gE[e].q], bull ? gL[gE[e].q] : gH[gE[e].q], gTimes[gE[e].p], bull ? gL[gE[e].p] : gH[gE[e].p]);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, bull ? clrLimeGreen : clrTomato); ObjectSetInteger(0, nm, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false); ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string na = PFX + "v" + IntegerToString(e) + "a";
      ObjectCreate(0, na, bull ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, gTimes[gE[e].idx], bull ? gL[gE[e].p] : gH[gE[e].p]);
      ObjectSetInteger(0, na, OBJPROP_COLOR, bull ? clrDeepSkyBlue : clrOrange); ObjectSetInteger(0, na, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, na, OBJPROP_HIDDEN, true);
     }
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, _Period, 1, MathMax(InpHistoryBars, 1000), rr);
   if(n < 500) { gBars = MathMax(n, 0); return false; }
   double o[], rs[]; ArrayResize(o, n); ArrayResize(gH, n); ArrayResize(gL, n); ArrayResize(gC, n); ArrayResize(gAtr, n); ArrayResize(gTimes, n); ArrayResize(rs, n);
   for(int i = 0; i < n; i++) { o[i] = rr[i].open; gH[i] = rr[i].high; gL[i] = rr[i].low; gC[i] = rr[i].close; gTimes[i] = rr[i].time; }
   AT24TP_Atr(n, gH, gL, gC, 14, gAtr); AT24DV_Rsi(n, gC, InpRsiPeriod, rs);
   gNe = AT24DV_Events(n, gH, gL, rs, InpSwingBars, InpMinSep, InpMaxSep, InpMinDiff, gE);
   double cost = InpCost > 0.0 ? InpCost : (SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID));
   if(cost < 0.0) cost = 0.0;
   int c0 = AT24DV_Trades(n, o, gH, gL, gC, gAtr, gE, gNe, 1, InpStopBufAtr, InpMaxRiskAtr, InpRewardRisk, InpMaxHold, cost, gTd);
   int c1 = AT24DV_Trades(n, o, gH, gL, gC, gAtr, gE, gNe, -1, InpStopBufAtr, InpMaxRiskAtr, InpRewardRisk, InpMaxHold, cost, gTs);
   int c2 = AT24DV_Trades(n, o, gH, gL, gC, gAtr, gE, gNe, 0, InpStopBufAtr, InpMaxRiskAtr, InpRewardRisk, InpMaxHold, cost, gTa);
   AT24SP_ScoreOf(gTd, c0, 20261111, gSc[0]); AT24SP_ScoreOf(gTs, c1, 20261111, gSc[1]); AT24SP_ScoreOf(gTa, c2, 20261111, gSc[2]);
   gBars = n;
   gLive = -1; gLiveOk = false;
   if(gNe > 0 && gE[gNe - 1].idx == n - 1)
     {
      gLive = gNe - 1; int d = gE[gLive].dir, p = gE[gLive].p;
      gLiveEntry = gC[n - 1];
      gLiveSl = d > 0 ? gL[p] - InpStopBufAtr * gAtr[n - 1] : gH[p] + InpStopBufAtr * gAtr[n - 1];
      double risk = d * (gLiveEntry - gLiveSl);
      gLiveOk = (risk > 0.0 && risk <= InpMaxRiskAtr * gAtr[n - 1]);
      gLiveTp = gLiveEntry + d * InpRewardRisk * risk;
     }
   B0[0] = gNe; B1[0] = gSc[0].avgR; B2[0] = gSc[1].avgR;
   DrawDivs();
   return true;
  }

void Refresh()
  {
   datetime bar = iTime(_Symbol, _Period, 0);
   if(gBuiltBar != bar) { if(Rebuild()) gBuiltBar = bar; }
   if(gBuiltBar == bar && gLive >= 0 && InpAlertNew && gAlertBar != bar)
     {
      gAlertBar = bar;
      string msg = StringFormat("AT24 Divergence Pro %s: %s RSI divergence confirmed%s", _Symbol, gE[gLive].dir > 0 ? "BULLISH" : "BEARISH",
                                gLiveOk ? StringFormat(", entry ~%s stop %s target %s", DoubleToString(gLiveEntry, _Digits), DoubleToString(gLiveSl, _Digits), DoubleToString(gLiveTp, _Digits)) : "");
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
  }

datetime g_initT = 0;
int EAInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(2);
   g_initT = TimeLocal();
   if(InpRsiPeriod < 2 || InpRsiPeriod > 100 || InpSwingBars < 2 || InpSwingBars > 20 || InpMinSep < 2 || InpMaxSep < InpMinSep || InpMaxSep > 500 || InpMinDiff < 0.0 || InpMinDiff > 30.0
      || InpStopBufAtr < 0.0 || InpStopBufAtr > 3.0 || InpMaxRiskAtr < 0.5 || InpMaxRiskAtr > 20.0 || InpRewardRisk < 0.3 || InpRewardRisk > 10.0 || InpMaxHold < 5 || InpMaxHold > 500 || InpCost < 0.0 || InpDrawDivs < 0)
     {
      Print("AT24 Divergence Pro: check the inputs (RSI 2-100, swing bars 2-20, separation 2-500, RSI difference 0-30, reward:risk 0.3-10, hold 5-500).");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int k = 0; k < 3; k++) gSc[k].n = 0;
   
   return INIT_SUCCEEDED;
  }

void EAChart(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void EADeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }


int AT24_Calc(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 10) return 0;
   Refresh();
   Draw();
   return rates_total;
  }

//--- EA driver: the former OnCalculate runs from the timer and on a new bar, behind the licence gate
datetime g_lastBar = 0;
bool g_snapDone = false;
void Step()
  {
   if(!AT24Gate_Allowed()) { ObjectsDeleteAll(0, PFX); return; }
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int want = (int)MathMin((double)iBars(_Symbol, _Period), 12000.0);
   int n = CopyRates(_Symbol, _Period, 0, want, r);
   if(n < 10) return;
   datetime tm[]; double op[], hi[], lo[], cl[]; long tv[]; int sp[];
   ArrayResize(tm, n); ArrayResize(op, n); ArrayResize(hi, n); ArrayResize(lo, n); ArrayResize(cl, n); ArrayResize(tv, n); ArrayResize(sp, n);
   for(int q = 0; q < n; q++) { tm[q] = r[q].time; op[q] = r[q].open; hi[q] = r[q].high; lo[q] = r[q].low; cl[q] = r[q].close; tv[q] = r[q].tick_volume; sp[q] = r[q].spread; }
   AT24_Calc(n, g_lastBar == 0 ? 0 : n - 1, tm, op, hi, lo, cl, tv, tv, sp);
   g_lastBar = tm[n - 1];
   if(InpSaveSnapshot && !g_snapDone && g_initT > 0 && TimeLocal() - g_initT >= 6)
     {
      string fn = "AT24_" + MQLInfoString(MQL_PROGRAM_NAME) + "_snapshot.png";
      if(ChartScreenShot(0, fn, 1280, 720, ALIGN_RIGHT)) { g_snapDone = true; Print("snapshot saved ", fn); }
     }
  }

void EATimer() { AT24Gate_Timer(InpLicenseKey); Step(); }
void EATick() { if(iTime(_Symbol, _Period, 0) != g_lastBar) Step(); }

void OnChartEventSnap() {}

void OnStart()
{
   if(EAInit() != INIT_SUCCEEDED) { Print("EAInit failed"); return; }
   for(int i = 0; i < 40 && !IsStopped() && !g_snapDone; i++) { EATimer(); Sleep(1000); }
}

