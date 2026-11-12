//+------------------------------------------------------------------+
//| AT24 Setup Pro (MT5)                                             |
//| Trade setups with levels AND the receipts: every setup shows its |
//| entry, stop and target before the trade, and every setup type is |
//| scored on this symbol's own history (count, hit rate, average R  |
//| after cost, luck test). Non-repainting: closed bars only.        |
//| A research and planning tool. Not a promise of results.          |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Setup Pro - setups with entry / stop / target levels, a multi-timeframe trend panel and a live scorecard per setup type on this symbol's own history."
#property description "It places no trades. Results on past bars do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   0

#include "AT24_Pullback_Core.mqh"
#include "AT24_Squeeze_Core.mqh"
#include "AT24_SP_Core.mqh"

#resource "sp_logo56.bmp"

input group "=== Setups ==="
input bool   InpPullback      = true;   // Trend pullback setups
input bool   InpSqueeze       = true;   // Squeeze release setups
input double InpStopAtr       = 1.5;    // Stop distance in ATR(14) of the signal bar
input double InpRewardRisk    = 2.0;    // Target as a multiple of the stop distance
input int    InpMaxHold       = 40;     // Bars before a trade is closed at the market (timed exit)
input double InpCost          = 0.0;    // Round-turn cost in price units (0 = the current spread)
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Chart ==="
input int    InpDrawSetups    = 12;     // Draw the last N setups on the chart (0 = none)
input group "=== Alerts (bar close) ==="
input bool   InpAlertNew      = false;  // Alert when a new setup forms
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[];
string PFX = "AT24SP_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24SP_Setup gStP[], gStQ[];
int    gCnt[2];
AT24SP_Setup SetupAt(const int ty, const int k) { if(ty == 0) return gStP[k]; return gStQ[k]; }
AT24SP_Score gSc[2];
int    gActive = -1, gActiveType = -1;           // index of an active (signal on the last closed bar) setup
double gActEntry = 0.0, gActSl = 0.0, gActTp = 0.0;
int    gActDir = 0;
int    gTrend[4];                                  // M15, H1, H4, D1: +1 / -1 / 0
ENUM_TIMEFRAMES gTf[4] = {PERIOD_M15, PERIOD_H1, PERIOD_H4, PERIOD_D1};
datetime gBuiltBar = 0, gAlertBar = 0;
datetime gTimes[];
double gCostUsed = 0.0;

#define DASH_W 410
#define DASH_H 372

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sp_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string TypeName(const int t) { return t == 0 ? "Trend pullback" : "Squeeze release"; }
string TrendTxt(const int t) { return t > 0 ? "UP" : (t < 0 ? "DOWN" : "RANGE"); }
color  TrendCol(const int t) { return t > 0 ? clrLimeGreen : (t < 0 ? clrTomato : clrSlateGray); }

string VerdictOf(const AT24SP_Score &s, color &c)
  {
   if(s.n < 30) { c = clrSlateGray; return StringFormat("too few setups (%d of 30)", s.n); }
   if(s.avgR > 0.0 && s.pFlip < 0.05) { c = clrLimeGreen; return StringFormat("POSITIVE ON THIS HISTORY (p %.3f)", s.pFlip); }
   if(s.avgR < 0.0 && s.pFlip > 0.95) { c = clrTomato; return "NEGATIVE ON THIS HISTORY"; }
   c = clrGold; return StringFormat("NO EDGE SHOWN (p %.2f)", s.pFlip);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 SETUP PRO", C'230,190,80', 10, true);
   if(gBars < 500)
     {
      MakeLabel("t2", 70, 26, "LOADING HISTORY", clrSlateGray, 11, true);
      return;
     }
   int dg = _Digits;
   if(gActive >= 0)
     {
      MakeLabel("t2", 70, 26, StringFormat("%s  %s setup", gActDir > 0 ? "LONG" : "SHORT", gActiveType == 0 ? "pullback" : "squeeze"), gActDir > 0 ? clrLimeGreen : clrTomato, 11, true);
      MakeLabel("t3", 70, 42, StringFormat("entry ~%s  stop %s  target %s  (R:R %.1f)", DoubleToString(gActEntry, dg), DoubleToString(gActSl, dg), DoubleToString(gActTp, dg), InpRewardRisk), clrWhite, 8, true);
     }
   else
     {
      MakeLabel("t2", 70, 26, "NO SETUP ON THE LAST CLOSED BAR", clrSlateGray, 10, true);
      MakeLabel("t3", 70, 42, StringFormat("%s, stop %.1f ATR, target %.1f R, cost %s", _Symbol, InpStopAtr, InpRewardRisk, DoubleToString(gCostUsed, dg)), clrSilver, 8);
     }
   MakeLabel("m0", 10, 66, "Trend on the timeframes", C'230,190,80', 8, true);
   string names[4] = {"M15", "H1", "H4", "D1"};
   for(int k = 0; k < 4; k++)
     {
      MakeLabel("mt" + IntegerToString(k), 10 + k * 98, 82, names[k] + " " + TrendTxt(gTrend[k]), TrendCol(gTrend[k]), 9, true);
     }
   bool up = (gTrend[0] > 0 && gTrend[1] > 0 && gTrend[2] > 0 && gTrend[3] > 0), dn = (gTrend[0] < 0 && gTrend[1] < 0 && gTrend[2] < 0 && gTrend[3] < 0);
   MakeLabel("m1", 10, 100, up ? "all four timeframes UP" : (dn ? "all four timeframes DOWN" : "timeframes are mixed"), up ? clrLimeGreen : (dn ? clrTomato : clrSilver), 8);
   MakeLabel("s0", 10, 126, "Scorecard on this symbol's own history", C'230,190,80', 8, true);
   int y = 142;
   for(int ty = 0; ty < 2; ty++)
     {
      bool on = (ty == 0) ? InpPullback : InpSqueeze;
      string id = IntegerToString(ty);
      if(!on) { MakeLabel("a" + id, 10, y, TypeName(ty) + ": off", clrSlateGray, 8, true); MakeLabel("b" + id, 10, y + 14, " ", clrWhite, 8); MakeLabel("c" + id, 10, y + 28, " ", clrWhite, 8); y += 52; continue; }
      color vc; string v = VerdictOf(gSc[ty], vc);
      MakeLabel("a" + id, 10, y, TypeName(ty), clrWhite, 9, true);
      MakeLabel("b" + id, 10, y + 15, StringFormat("%d setups   hit %.0f %%   average %+.2f R after cost   total %+.0f R", gSc[ty].n, gSc[ty].hitPct, gSc[ty].avgR, gSc[ty].sumR), clrWhite, 8);
      MakeLabel("c" + id, 10, y + 29, v, vc, 8, true);
      y += 54;
     }
   MakeLabel("n1", 10, 254, "Levels are drawn before the trade; every setup is walked", clrSlateGray, 8);
   MakeLabel("n2", 10, 268, "forward on the bars (stop first if both hit in one bar).", clrSlateGray, 8);
   MakeLabel("n3", 10, 282, "Past results on this symbol do not predict future results.", clrSlateGray, 8);
   MakeLabel("n4", 10, 296, "No edge shown = the setup did not beat luck here.", clrSlateGray, 8);
   MakeLabel("f1", 10, 322, StringFormat("%d bars analysed, closed bars only (no repainting).", gBars), clrSlateGray, 7);
   MakeLabel("f2", 10, 333, "Research and planning tool, not a signal. algotraders24.ai", clrSlateGray, 7);
  }

void DrawSetups()
  {
   ObjectsDeleteAll(0, PFX + "s");
   ObjectsDeleteAll(0, PFX + "lv");
   if(InpDrawSetups <= 0 || gBars < 10) return;
   //--- merge both types by signal bar, take the last N
   int idxs[], tys[], pos[]; int tot = 0;
   for(int ty = 0; ty < 2; ty++) for(int k = 0; k < gCnt[ty]; k++) { ArrayResize(idxs, tot + 1); ArrayResize(tys, tot + 1); ArrayResize(pos, tot + 1); idxs[tot] = SetupAt(ty, k).idx; tys[tot] = ty; pos[tot] = k; tot++; }
   for(int i = 1; i < tot; i++) { int a = idxs[i], b = tys[i], c = pos[i], j = i - 1; while(j >= 0 && idxs[j] > a) { idxs[j + 1] = idxs[j]; tys[j + 1] = tys[j]; pos[j + 1] = pos[j]; j--; } idxs[j + 1] = a; tys[j + 1] = b; pos[j + 1] = c; }
   int from = MathMax(0, tot - InpDrawSetups);
   for(int q = from; q < tot; q++)
     {
      AT24SP_Setup s = SetupAt(tys[q], pos[q]);
      datetime t0 = gTimes[s.idx + 1 < gBars ? s.idx + 1 : s.idx];
      datetime t1 = (s.exitIdx >= 0 && s.exitIdx < gBars) ? gTimes[s.exitIdx] : gTimes[gBars - 1];
      color c = (s.result == 1) ? clrLimeGreen : ((s.result == -1) ? clrTomato : ((s.result == 0) ? clrGold : clrWhite));
      string nm = PFX + "s" + IntegerToString(q);
      ObjectCreate(0, nm, OBJ_TREND, 0, t0, s.entry, t1, (s.result == 1) ? s.tp : ((s.result == -1) ? s.sl : s.entry));
      ObjectSetInteger(0, nm, OBJPROP_COLOR, c); ObjectSetInteger(0, nm, OBJPROP_WIDTH, 2); ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false); ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string na = PFX + "s" + IntegerToString(q) + "a";
      ObjectCreate(0, na, s.dir > 0 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, gTimes[s.idx], s.dir > 0 ? s.sl : s.sl);
      ObjectSetInteger(0, na, OBJPROP_COLOR, s.dir > 0 ? clrDeepSkyBlue : clrOrange); ObjectSetInteger(0, na, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, na, OBJPROP_HIDDEN, true);
      ObjectSetDouble(0, na, OBJPROP_PRICE, s.entry);
     }
   if(gActive >= 0)
     {
      datetime tl = gTimes[gBars - 1], tr2 = tl + (datetime)(PeriodSeconds() * 12);
      double lv[3] = {gActEntry, gActSl, gActTp}; color lc[3] = {clrWhite, clrTomato, clrLimeGreen}; string ln[3] = {"entry", "stop", "target"};
      for(int k = 0; k < 3; k++)
        {
         string nm = PFX + "lv" + ln[k];
         ObjectCreate(0, nm, OBJ_TREND, 0, tl, lv[k], tr2, lv[k]);
         ObjectSetInteger(0, nm, OBJPROP_COLOR, lc[k]); ObjectSetInteger(0, nm, OBJPROP_WIDTH, 2); ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
         ObjectSetString(0, nm, OBJPROP_TEXT, ln[k]);
        }
     }
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, _Period, 1, MathMax(InpHistoryBars, 1000), rr);
   if(n < 500) { gBars = MathMax(n, 0); return false; }
   double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(gTimes, n);
   for(int i = 0; i < n; i++) { o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; c[i] = rr[i].close; gTimes[i] = rr[i].time; }
   double ef[], em[], es[], at[]; int tr[];
   ArrayResize(ef, n); ArrayResize(em, n); ArrayResize(es, n); ArrayResize(at, n); ArrayResize(tr, n);
   AT24TP_Ema(n, c, 20, ef); AT24TP_Ema(n, c, 50, em); AT24TP_Ema(n, c, 200, es); AT24TP_Atr(n, h, l, c, 14, at);
   AT24TP_Trend(n, ef, em, es, at, 200, 5, 0.10, tr);
   double cost = InpCost > 0.0 ? InpCost : (SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID));
   if(cost < 0.0) cost = 0.0;
   gCostUsed = cost;
   ArrayResize(gStP, 0); ArrayResize(gStQ, 0); gCnt[0] = 0; gCnt[1] = 0;
   if(InpPullback)
     {
      AT24TP_Ev pev[]; int np = AT24TP_Events(n, h, l, c, ef, em, at, tr, 20, 20, pev);
      int pi[], pd[]; ArrayResize(pi, np); ArrayResize(pd, np);
      for(int k = 0; k < np; k++) { pi[k] = pev[k].idx; pd[k] = pev[k].dir; }
      gCnt[0] = AT24SP_Simulate(n, o, h, l, c, at, pi, pd, np, 0, InpStopAtr, InpRewardRisk, InpMaxHold, cost, gStP);
     }
   if(InpSqueeze)
     {
      double mid[], mom[], at2[], ratio[]; int sq[]; ArrayResize(mid, n); ArrayResize(mom, n); ArrayResize(at2, n); ArrayResize(ratio, n); ArrayResize(sq, n);
      AT24SQ_Calc(n, h, l, c, 20, 2.0, 20, 1.5, 14, mid, mom, at2, ratio, sq);
      AT24SQ_Ev qev[]; int nq = AT24SQ_Events(n, h, l, c, mid, at2, sq, 6, 20, qev);
      int qi[], qd[]; ArrayResize(qi, nq); ArrayResize(qd, nq);
      for(int k = 0; k < nq; k++) { qi[k] = qev[k].idx; qd[k] = qev[k].mom; }
      gCnt[1] = AT24SP_Simulate(n, o, h, l, c, at2, qi, qd, nq, 1, InpStopAtr, InpRewardRisk, InpMaxHold, cost, gStQ);
     }
   AT24SP_ScoreOf(gStP, gCnt[0], 20261111, gSc[0]); AT24SP_ScoreOf(gStQ, gCnt[1], 20261111, gSc[1]);
   gBars = n;
   //--- a setup whose signal bar is the last closed bar is the live one (entry = next open, shown at the last close)
   gActive = -1; gActiveType = -1;
   //--- the simulator needs a next bar, so a signal on the very last closed bar is re-detected here
   AT24TP_Ev pe2[]; int np2 = AT24TP_Events(n, h, l, c, ef, em, at, tr, 20, 20, pe2);
   for(int k = np2 - 1; k >= 0 && InpPullback; k--) { if(pe2[k].idx == n - 1) { gActive = n - 1; gActiveType = 0; gActDir = pe2[k].dir; } break; }
   if(gActive < 0 && InpSqueeze)
     {
      double mid[], mom[], at2[], ratio[]; int sq[]; ArrayResize(mid, n); ArrayResize(mom, n); ArrayResize(at2, n); ArrayResize(ratio, n); ArrayResize(sq, n);
      AT24SQ_Calc(n, h, l, c, 20, 2.0, 20, 1.5, 14, mid, mom, at2, ratio, sq);
      AT24SQ_Ev qe2[]; int nq2 = AT24SQ_Events(n, h, l, c, mid, at2, sq, 6, 20, qe2);
      for(int k = nq2 - 1; k >= 0; k--) { if(qe2[k].idx == n - 1) { gActive = n - 1; gActiveType = 1; gActDir = qe2[k].mom; } break; }
     }
   if(gActive >= 0)
     {
      double risk = InpStopAtr * at[n - 1];
      gActEntry = c[n - 1]; gActSl = gActEntry - gActDir * risk; gActTp = gActEntry + gActDir * InpRewardRisk * risk;
     }
   //--- multi-timeframe trend panel
   for(int k = 0; k < 4; k++)
     {
      MqlRates mr[]; int m = CopyRates(_Symbol, gTf[k], 1, 1500, mr);
      gTrend[k] = 0;
      if(m < 260) continue;
      double mc[], mh[], ml[], mf[], mm[], ms[], ma[]; int mt[];
      ArrayResize(mc, m); ArrayResize(mh, m); ArrayResize(ml, m); ArrayResize(mf, m); ArrayResize(mm, m); ArrayResize(ms, m); ArrayResize(ma, m); ArrayResize(mt, m);
      for(int i = 0; i < m; i++) { mc[i] = mr[i].close; mh[i] = mr[i].high; ml[i] = mr[i].low; }
      AT24TP_Ema(m, mc, 20, mf); AT24TP_Ema(m, mc, 50, mm); AT24TP_Ema(m, mc, 200, ms); AT24TP_Atr(m, mh, ml, mc, 14, ma);
      AT24TP_Trend(m, mf, mm, ms, ma, 200, 5, 0.10, mt);
      gTrend[k] = mt[m - 1];
     }
   B0[0] = gSc[0].avgR; B1[0] = gSc[1].avgR; B2[0] = gActive >= 0 ? gActDir : 0;
   DrawSetups();
   return true;
  }

void Refresh()
  {
   datetime bar = iTime(_Symbol, _Period, 0);
   if(gBuiltBar != bar) { if(Rebuild()) gBuiltBar = bar; }
   if(gBuiltBar == bar && gActive >= 0 && InpAlertNew && gAlertBar != bar)
     {
      gAlertBar = bar;
      string msg = StringFormat("AT24 Setup Pro %s: %s %s setup, entry ~%s stop %s target %s", _Symbol, gActDir > 0 ? "LONG" : "SHORT", gActiveType == 0 ? "pullback" : "squeeze", DoubleToString(gActEntry, _Digits), DoubleToString(gActSl, _Digits), DoubleToString(gActTp, _Digits));
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Setup Pro");
   if(InpStopAtr < 0.3 || InpStopAtr > 10.0 || InpRewardRisk < 0.3 || InpRewardRisk > 10.0 || InpMaxHold < 5 || InpMaxHold > 500 || InpCost < 0.0 || InpDrawSetups < 0)
     {
      Print("AT24 Setup Pro: stop 0.3-10 ATR, reward:risk 0.3-10, hold 5-500 bars, cost >= 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int k = 0; k < 4; k++) gTrend[k] = 0;
   gSc[0].n = 0; gSc[1].n = 0;
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
