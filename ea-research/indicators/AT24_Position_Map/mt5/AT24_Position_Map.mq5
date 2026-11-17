//+------------------------------------------------------------------+
//| AT24 Position Map (MT5)                                          |
//| Positional price action with exact rules: the WEEKLY structure   |
//| (higher highs + higher lows, or lower highs + lower lows) gives  |
//| the only direction; a pullback into it is measured; an H4 higher |
//| low (or lower high) and a close beyond the last counter swing is |
//| the trigger. Entry, structural stop and three targets (1:3, 1:4, |
//| 1:5) are drawn before the trade and every setup the rules would  |
//| have produced is scored on this symbol's own history.            |
//| Non-repainting: closed bars only. Rules: SPEC.md.                |
//| A research and planning tool. Places no trades. Not advice.      |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Position Map - weekly structure gives the direction, an H4 turn inside a weekly pullback gives the entry; stop and three targets (1:3, 1:4, 1:5) are planned before the trade and scored on this symbol's own history."
#property description "It places no trades. Results on past bars do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 8
#property indicator_plots   0

#include "AT24_PM_Core.mqh"

#resource "pm_logo56.bmp"

input group "=== Rules (see SPEC) ==="
input int    InpSwingW        = 2;      // Swing bars each side: weekly
input int    InpSwingD        = 3;      // Swing bars each side: daily (information only)
input int    InpSwingH        = 3;      // Swing bars each side: H4 (entry)
input double InpMinSwingAtr   = 0.75;   // Smallest swing in ATR(14) of its timeframe
input double InpMinRetrace    = 0.382;  // Smallest pullback as a share of the last weekly leg
input double InpStopBufAtr    = 0.25;   // Stop buffer beyond the pullback extreme in ATR(14) of H4
input double InpRR1           = 3.0;    // Target 1 as a multiple of the risk (1:3)
input double InpRR2           = 4.0;    // Target 2 (1:4)
input double InpRR3           = 5.0;    // Target 3 (1:5)
input int    InpTimeStopWeeks = 8;      // Weeks before a trade that hit neither stop nor target is closed
input group "=== Costs and size ==="
input double InpCost          = 0.0;    // Round-turn cost in price units (0 = the current spread)
input bool   InpUseSwap       = true;   // Include the broker swap of the holding time in the scorecard
input double InpRiskPercent   = 0.5;    // Risk per trade for the lot size shown, percent of balance
input group "=== History ==="
input int    InpH4Bars        = 7000;   // H4 bars analysed
input int    InpWeeklyBars    = 520;    // Weekly bars analysed
input group "=== Chart ==="
input bool   InpDrawWeekly    = true;   // Draw weekly swings, structure levels and the pullback zone
input int    InpDrawPlans     = 6;      // Draw the last N past setups (entry to the result of target 1)
input group "=== Alerts (bar close) ==="
input bool   InpAlertNew      = false;  // Alert when a setup triggers on a closed H4 bar
input bool   InpAlertTrend    = false;  // Alert when the weekly trend changes
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[], B5[], B6[], B7[];
string PFX = "AT24PM_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;

AT24PM_Params gP;
AT24PM_Plan   gPl[];
int           gNp = 0;
AT24PM_Swing  gSwW[], gSwD[], gSwH[];
int           gCW = 0, gCD = 0, gCH = 0;
datetime      gTW[], gTD[], gTH[];
double        gOH[], gHH[], gLH[], gCH_[], gAtrW[], gAtrH[];
int           gNW = 0, gND = 0, gNH = 0;
AT24PM_Score  gSc[3], gSk[3];
AT24PM_Life   gLife;
AT24PM_Ctx    gCtx;
int           gTrendW = 0, gTrendD = 0, gTrendH = 0;
int           gLive = -1;                 // index of the live plan in gPl (-1 none)
bool          gLivePending = false;       // the trigger is on the last closed bar: the entry is the next H4 open
double        gCostUsed = 0.0, gSwapL = 0.0, gSwapS = 0.0;   // price units
double        gLots = 0.0;
datetime      gBuiltBar = 0, gAlertBar = 0, gLastWBar = 0;
int           gLastWTrend = 99;
string        gStatus = "";

#define DASH_W 480
#define DASH_H 540

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::pm_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string TrendTxt(const int t) { return t > 0 ? "UP" : (t < 0 ? "DOWN" : "RANGE"); }
color  TrendCol(const int t) { return t > 0 ? clrLimeGreen : (t < 0 ? clrTomato : clrSlateGray); }

string VerdictOf(const AT24PM_Score &s, color &c)
  {
   if(s.n < 30) { c = clrSlateGray; return StringFormat("too few setups (%d of 30)", s.n); }
   if(s.avgR > 0.0 && s.pFlip < 0.05) { c = clrLimeGreen; return StringFormat("POSITIVE ON THIS HISTORY (p %.3f)", s.pFlip); }
   if(s.avgR < 0.0 && s.pFlip > 0.95) { c = clrTomato; return "NEGATIVE ON THIS HISTORY"; }
   c = clrGold; return StringFormat("NO EDGE SHOWN (p %.2f)", s.pFlip);
  }

//--- what the rules are waiting for right now (from the same Eval the scan uses); two short lines (a label is cut at about 58 characters)
string StageTxt(color &c, string &sub)
  {
   int dg = _Digits;
   sub = " ";
   if(gLive >= 0 && !gLivePending) { c = clrSlateGray; sub = "a new trigger waits until all three targets are done"; return "A plan is running"; }
   if(gCtx.dir == 0) { c = clrSlateGray; sub = "a trend needs HH+HL (up) or LH+LL (down)"; return "W1 is a RANGE: no direction, no trade"; }
   string side = gCtx.dir > 0 ? "UP" : "DOWN";
   c = gCtx.dir > 0 ? clrLimeGreen : clrTomato;
   switch(gCtx.stage)
     {
      case 1: sub = StringFormat("needs %.1f %% of the last weekly leg", InpMinRetrace * 100.0); return StringFormat("W1 %s: waiting for a pullback (now %.0f %%)", side, MathMax(0.0, gCtx.depth) * 100.0);
      case 2: sub = StringFormat("then a close %s it triggers", gCtx.dir > 0 ? "above the lower high" : "below the higher low"); return StringFormat("W1 %s: pullback %.0f %% in zone, wait for H4 %s", side, gCtx.depth * 100.0, gCtx.dir > 0 ? "higher low" : "lower high");
      case 3: sub = "entry is the next H4 open after that close"; return StringFormat("H4 turn formed: a close %s %s triggers", gCtx.dir > 0 ? "above" : "below", DoubleToString(gCtx.B, dg));
      case 4: c = clrGold; sub = "entry is the next H4 open"; return "TRIGGER on the last closed H4 bar";
     }
   return "";
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 POSITION MAP", C'230,190,80', 10, true);
   if(gNH < 600 || gNW < 60)
     {
      MakeLabel("t2", 70, 26, gStatus == "" ? "LOADING HISTORY" : gStatus, clrSlateGray, 9, true);
      return;
     }
   int dg = _Digits;
   color sc; string sub; string st = StageTxt(sc, sub);
   MakeLabel("t2", 70, 26, StringFormat("W1 %s    D1 %s    H4 %s", TrendTxt(gTrendW), TrendTxt(gTrendD), TrendTxt(gTrendH)), TrendCol(gTrendW), 10, true);
   MakeLabel("t3", 70, 42, "direction comes from the weekly structure only", clrSilver, 8);
   MakeLabel("s1", 10, 66, st, sc, 9, true);
   MakeLabel("s2", 10, 82, sub, clrSilver, 8);
   //--- the live plan
   if(gLive >= 0)
     {
      AT24PM_Plan p = gPl[gLive];
      bool pend = gLivePending;
      double e = pend ? gCH_[gNH - 1] : p.entry;
      double sl = p.sl;
      double rk = MathAbs(e - sl);
      double tp1 = e + p.dir * InpRR1 * rk, tp2 = e + p.dir * InpRR2 * rk, tp3 = e + p.dir * InpRR3 * rk;
      double atrw = MathMax(gAtrW[gNW - 1], _Point);
      MakeLabel("p0", 10, 104, StringFormat("%s plan%s", p.dir > 0 ? "LONG" : "SHORT", pend ? " (entry next open, shown at last close)" : ""), p.dir > 0 ? clrLimeGreen : clrTomato, 9, true);
      MakeLabel("p1", 10, 120, StringFormat("entry %s     stop %s", DoubleToString(e, dg), DoubleToString(sl, dg)), clrWhite, 8);
      MakeLabel("p1b", 10, 134, "stop is structural: beyond the pullback extreme", clrSilver, 8);
      MakeLabel("p2", 10, 148, StringFormat("TP1 1:%.0f %s   TP2 1:%.0f %s   TP3 1:%.0f %s", InpRR1, DoubleToString(tp1, dg), InpRR2, DoubleToString(tp2, dg), InpRR3, DoubleToString(tp3, dg)), clrWhite, 8);
      MakeLabel("p3", 10, 162, StringFormat("risk %s = %.1f weekly ATR%s", DoubleToString(rk, dg), rk / atrw, rk / atrw > 2.5 ? "  (WIDE)" : ""), rk / atrw > 2.5 ? clrGold : clrSilver, 8);
      double swapW = (p.dir > 0 ? gSwapL : gSwapS) * 7.0 / MathMax(rk, _Point);
      MakeLabel("p3b", 10, 176, StringFormat("lots for %.1f %% risk: %s     swap %+.2f R a week", InpRiskPercent, gLots > 0.0 ? DoubleToString(gLots, 2) : "n/a", -swapW), clrSilver, 8);
      if(!pend)
        {
         string sts[3]; for(int q = 0; q < 3; q++) sts[q] = p.st[q] == 1 ? "hit" : (p.st[q] == -1 ? "stopped" : (p.st[q] == 0 ? "timed out" : "open"));
         MakeLabel("p4", 10, 190, StringFormat("so far:  TP1 %s   TP2 %s   TP3 %s", sts[0], sts[1], sts[2]), clrSilver, 8);
        }
      else MakeLabel("p4", 10, 190, " ", clrWhite, 8);
     }
   else
     {
      MakeLabel("p0", 10, 104, "NO ACTIVE PLAN", clrSlateGray, 9, true);
      string last = " ";
      if(gNp > 0)
        {
         AT24PM_Plan p = gPl[gNp - 1];
         last = StringFormat("last setup: %s, entry %s, 1:3 result %+.2f R", p.dir > 0 ? "long" : "short", DoubleToString(p.entry, dg), p.r[0]);
        }
      MakeLabel("p1", 10, 120, last, clrSilver, 8);
      MakeLabel("p1b", 10, 134, StringFormat("%s   spread %s", _Symbol, DoubleToString(gCostUsed, dg)), clrSilver, 8);
      MakeLabel("p2", 10, 148, " ", clrWhite, 8); MakeLabel("p3", 10, 162, " ", clrWhite, 8); MakeLabel("p3b", 10, 176, " ", clrWhite, 8); MakeLabel("p4", 10, 190, " ", clrWhite, 8);
     }
   //--- scorecards
   MakeLabel("c0", 10, 214, "Scorecard on this symbol's own history", C'230,190,80', 8, true);
   double rrs[3] = {InpRR1, InpRR2, InpRR3};
   int y = 230;
   for(int q = 0; q < 3; q++)
     {
      color vc; string v = VerdictOf(gSc[q], vc);
      string id = IntegerToString(q);
      MakeLabel("a" + id, 10, y, StringFormat("1:%.0f   %d setups   hit %.0f %%   avg %+.2f R   total %+.0f R", rrs[q], gSc[q].n, gSc[q].hitPct, gSc[q].avgR, gSc[q].sumR), clrWhite, 8);
      MakeLabel("b" + id, 10, y + 14, StringFormat("%s   other way %+.2f R", v, gSk[q].avgR), vc, 8, true);
      y += 32;
     }
   MakeLabel("c9", 10, y, StringFormat("%d setups, %d not resolved. Cost = spread + swap.", gNp, gSc[0].open), clrSlateGray, 7);
   //--- trend life
   int y2 = y + 22;
   MakeLabel("l0", 10, y2, "Trend life on this symbol (weekly legs)", C'230,190,80', 8, true);
   MakeLabel("l1", 10, y2 + 16, StringFormat("up legs %d, median %.1f wk    down legs %d, median %.1f wk", gLife.nUp, gLife.medWeeksUp, gLife.nDown, gLife.medWeeksDown), clrWhite, 8);
   MakeLabel("l2", 10, y2 + 30, StringFormat("pullback after an up leg (%d): median %.0f %% = %.1f ATR", gLife.pbUpN, gLife.pbUpMedPct, gLife.pbUpMedAtr), clrSilver, 8);
   MakeLabel("l2b", 10, y2 + 43, StringFormat("   past 61.8 %%: %.0f %%    ended the trend: %.0f %%", gLife.pbUpOver618, gLife.pbUpBroke), clrSilver, 8);
   MakeLabel("l3", 10, y2 + 57, StringFormat("bounce after a down leg (%d): median %.0f %% = %.1f ATR", gLife.pbDownN, gLife.pbDownMedPct, gLife.pbDownMedAtr), clrSilver, 8);
   MakeLabel("l3b", 10, y2 + 70, StringFormat("   past 61.8 %%: %.0f %%    ended the trend: %.0f %%", gLife.pbDownOver618, gLife.pbDownBroke), clrSilver, 8);
   MakeLabel("n1", 10, y2 + 92, "Past results do not predict future results.", clrSlateGray, 8);
   MakeLabel("n2", 10, y2 + 105, "No edge shown = it did not beat luck here.", clrSlateGray, 8);
   MakeLabel("f1", 10, DASH_H - 24, StringFormat("%d H4 / %d weekly bars, closed bars only.", gNH, gNW), clrSlateGray, 7);
   MakeLabel("f2", 10, DASH_H - 13, "Planning tool, not a signal. algotraders24.ai", clrSlateGray, 7);
  }

void Seg(const string name, const datetime t0, const double p0, const datetime t1, const double p1, const color c, const int w, const ENUM_LINE_STYLE style, const string txt, const bool rayRight)
  {
   string nm = PFX + name;
   if(ObjectFind(0, nm) >= 0) ObjectDelete(0, nm);
   ObjectCreate(0, nm, OBJ_TREND, 0, t0, p0, t1, p1);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, w);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, style);
   ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, rayRight);
   ObjectSetInteger(0, nm, OBJPROP_BACK, true);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
   ObjectSetString(0, nm, OBJPROP_TEXT, txt);
  }

void DrawChart()
  {
   ObjectsDeleteAll(0, PFX + "w");
   ObjectsDeleteAll(0, PFX + "ps");
   ObjectsDeleteAll(0, PFX + "lv");
   ObjectsDeleteAll(0, PFX + "z");
   if(gNH < 600 || gNW < 60) return;
   datetime now = gTH[gNH - 1];
   datetime fut = now + (datetime)(PeriodSeconds() * 24);
   int dg = _Digits;
   if(InpDrawWeekly)
     {
      //--- the newest active weekly swings as arrows, and the structure levels as rays
      int act[]; int m = AT24PM_LastActive(gSwW, gCW, gNW - 1, 8, act);
      for(int k = 0; k < m; k++)
        {
         AT24PM_Swing s = gSwW[act[k]];
         string nm = PFX + "w" + IntegerToString(k);
         ObjectCreate(0, nm, OBJ_ARROW, 0, gTW[s.bar], s.price);
         ObjectSetInteger(0, nm, OBJPROP_ARROWCODE, s.type > 0 ? 234 : 233);
         ObjectSetInteger(0, nm, OBJPROP_ANCHOR, s.type > 0 ? ANCHOR_BOTTOM : ANCHOR_TOP);
         ObjectSetInteger(0, nm, OBJPROP_COLOR, s.type > 0 ? C'230,120,100' : C'90,200,140');
         ObjectSetInteger(0, nm, OBJPROP_WIDTH, 2);
         ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
        }
      int hiN = -1, loN = -1;
      for(int k = 0; k < m; k++) { if(gSwW[act[k]].type > 0 && hiN < 0) hiN = act[k]; if(gSwW[act[k]].type < 0 && loN < 0) loN = act[k]; }
      if(hiN >= 0) Seg("wlvh", gTW[gSwW[hiN].bar], gSwW[hiN].price, now, gSwW[hiN].price, C'230,120,100', 1, STYLE_DOT, "W1 swing high " + DoubleToString(gSwW[hiN].price, dg), true);
      if(loN >= 0) Seg("wlvl", gTW[gSwW[loN].bar], gSwW[loN].price, now, gSwW[loN].price, C'90,200,140', 1, STYLE_DOT, "W1 swing low " + DoubleToString(gSwW[loN].price, dg), true);
      //--- the pullback zone: from the minimum retracement down to the base of the last weekly leg
      if(gCtx.dir != 0 && gCtx.legLen > 0.0)
        {
         double edge = gCtx.legTop - gCtx.dir * InpMinRetrace * gCtx.legLen;
         string zn = PFX + "z0";
         ObjectCreate(0, zn, OBJ_RECTANGLE, 0, gTH[MathMax(0, gNH - 400)], edge, fut, gCtx.legBase);
         ObjectSetInteger(0, zn, OBJPROP_COLOR, gCtx.dir > 0 ? C'24,70,50' : C'80,36,36');
         ObjectSetInteger(0, zn, OBJPROP_FILL, true);
         ObjectSetInteger(0, zn, OBJPROP_BACK, true);
         ObjectSetInteger(0, zn, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, zn, OBJPROP_HIDDEN, true);
         ObjectSetString(0, zn, OBJPROP_TEXT, "pullback zone");
        }
     }
   //--- past setups: a line from the entry to the result of target 1
   if(InpDrawPlans > 0)
     {
      int from = MathMax(0, gNp - InpDrawPlans), cnt = 0;
      for(int q = gNp - 1; q >= from; q--)
        {
         AT24PM_Plan p = gPl[q];
         if(p.status != 1 || p.entryIdx < 0 || q == gLive) continue;
         datetime t0 = gTH[p.entryIdx];
         datetime t1 = (p.ex[0] >= 0 && p.ex[0] < gNH) ? gTH[p.ex[0]] : gTH[gNH - 1];
         double px1 = p.st[0] == 1 ? p.tp[0] : (p.st[0] == -1 ? p.sl : p.entry);
         color c = p.st[0] == 1 ? clrLimeGreen : (p.st[0] == -1 ? clrTomato : clrGold);
         Seg("ps" + IntegerToString(cnt), t0, p.entry, t1, px1, c, 2, STYLE_DOT, p.dir > 0 ? "long" : "short", false);
         cnt++;
        }
     }
   //--- the live plan: entry, stop and three targets
   if(gLive >= 0)
     {
      AT24PM_Plan p = gPl[gLive];
      double e = gLivePending ? gCH_[gNH - 1] : p.entry;
      double rk = MathAbs(e - p.sl);
      datetime tl = gLivePending ? gTH[gNH - 1] : gTH[p.entryIdx];
      double lv[5]; lv[0] = e; lv[1] = p.sl; lv[2] = e + p.dir * InpRR1 * rk; lv[3] = e + p.dir * InpRR2 * rk; lv[4] = e + p.dir * InpRR3 * rk;
      color lc[5]; lc[0] = clrWhite; lc[1] = clrTomato; lc[2] = clrLimeGreen; lc[3] = clrLimeGreen; lc[4] = clrLimeGreen;
      string ln[5]; ln[0] = "entry"; ln[1] = "stop"; ln[2] = StringFormat("TP1 1:%.0f", InpRR1); ln[3] = StringFormat("TP2 1:%.0f", InpRR2); ln[4] = StringFormat("TP3 1:%.0f", InpRR3);
      for(int k = 0; k < 5; k++) Seg("lv" + IntegerToString(k), tl, lv[k], fut, lv[k], lc[k], 2, STYLE_SOLID, ln[k] + " " + DoubleToString(lv[k], dg), false);
     }
  }

//--- broker swap as a COST in price units per calendar day (positive = cost). A triple-swap day adds 2 days a week, so the average day is 9/7 of the daily swap.
double SwapCostPerDay(const bool isLong)
  {
   if(!InpUseSwap) return 0.0;
   double sw = SymbolInfoDouble(_Symbol, isLong ? SYMBOL_SWAP_LONG : SYMBOL_SWAP_SHORT);
   long mode = SymbolInfoInteger(_Symbol, SYMBOL_SWAP_MODE);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double cost = 0.0;
   if(mode == SYMBOL_SWAP_MODE_POINTS) cost = -sw * _Point;
   else if(mode == SYMBOL_SWAP_MODE_CURRENCY_SYMBOL || mode == SYMBOL_SWAP_MODE_CURRENCY_MARGIN || mode == SYMBOL_SWAP_MODE_CURRENCY_DEPOSIT) { if(tv > 0.0 && ts > 0.0) cost = -sw / (tv / ts); }
   else if(mode == SYMBOL_SWAP_MODE_INTEREST_CURRENT || mode == SYMBOL_SWAP_MODE_INTEREST_OPEN) cost = -sw / 100.0 * SymbolInfoDouble(_Symbol, SYMBOL_BID) / 365.0;
   return cost * 9.0 / 7.0;
  }

double LotsFor(const double riskDist)
  {
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(tv <= 0.0 || ts <= 0.0 || riskDist <= 0.0 || step <= 0.0) return 0.0;
   double money = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPercent / 100.0;
   double lots = money / ((riskDist / ts) * tv);
   lots = MathFloor(lots / step) * step;
   return MathMax(vmin, MathMin(vmax, lots));
  }

bool Rebuild()
  {
   MqlRates rw[], rd[], rh[];
   int nW = CopyRates(_Symbol, PERIOD_W1, 1, MathMax(InpWeeklyBars, 100), rw);
   int nD = CopyRates(_Symbol, PERIOD_D1, 1, 2000, rd);
   int nH = CopyRates(_Symbol, PERIOD_H4, 1, MathMax(InpH4Bars, 1000), rh);
   if(nW < 60 || nD < 200 || nH < 600) { gNW = MathMax(nW, 0); gNH = MathMax(nH, 0); gStatus = StringFormat("LOADING HISTORY (W1 %d, D1 %d, H4 %d bars)", nW, nD, nH); return false; }
   double hW[], lW[], cW[], hD[], lD[], cD[];
   ArrayResize(gTW, nW); ArrayResize(hW, nW); ArrayResize(lW, nW); ArrayResize(cW, nW);
   ArrayResize(gTD, nD); ArrayResize(hD, nD); ArrayResize(lD, nD); ArrayResize(cD, nD);
   ArrayResize(gTH, nH); ArrayResize(gOH, nH); ArrayResize(gHH, nH); ArrayResize(gLH, nH); ArrayResize(gCH_, nH);
   for(int i = 0; i < nW; i++) { gTW[i] = rw[i].time; hW[i] = rw[i].high; lW[i] = rw[i].low; cW[i] = rw[i].close; }
   for(int i = 0; i < nD; i++) { gTD[i] = rd[i].time; hD[i] = rd[i].high; lD[i] = rd[i].low; cD[i] = rd[i].close; }
   for(int i = 0; i < nH; i++) { gTH[i] = rh[i].time; gOH[i] = rh[i].open; gHH[i] = rh[i].high; gLH[i] = rh[i].low; gCH_[i] = rh[i].close; }
   gNW = nW; gND = nD; gNH = nH;
   gStatus = "";
   double cost = InpCost > 0.0 ? InpCost : (SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID));
   if(cost < 0.0) cost = 0.0;
   gCostUsed = cost; gSwapL = SwapCostPerDay(true); gSwapS = SwapCostPerDay(false);
   gP.kW = InpSwingW; gP.kD = InpSwingD; gP.kH = InpSwingH; gP.minSwingAtr = InpMinSwingAtr; gP.minRetrace = InpMinRetrace; gP.stopBufAtr = InpStopBufAtr;
   gP.rr1 = InpRR1; gP.rr2 = InpRR2; gP.rr3 = InpRR3; gP.timeStopWeeks = InpTimeStopWeeks; gP.cost = cost; gP.swapLong = gSwapL; gP.swapShort = gSwapS;
   AT24PM_Atr(nW, hW, lW, cW, gAtrW); double atD[]; AT24PM_Atr(nD, hD, lD, cD, atD); AT24PM_Atr(nH, gHH, gLH, gCH_, gAtrH);
   gCW = AT24PM_Swings(nW, hW, lW, cW, gAtrW, gP.kW, gP.minSwingAtr, gSwW);
   gCD = AT24PM_Swings(nD, hD, lD, cD, atD, gP.kD, gP.minSwingAtr, gSwD);
   gCH = AT24PM_Swings(nH, gHH, gLH, gCH_, gAtrH, gP.kH, gP.minSwingAtr, gSwH);
   gNp = AT24PM_Run(nW, gTW, hW, lW, cW, nH, gTH, gOH, gHH, gLH, gCH_, gP, gPl);
   for(int q = 0; q < 3; q++) { AT24PM_ScoreOf(gPl, gNp, 20261117, false, q, gSc[q]); AT24PM_ScoreOf(gPl, gNp, 20261117, true, q, gSk[q]); }
   AT24PM_LifeOf(gSwW, gCW, gTW, gAtrW, gLife);
   AT24PM_Eval(nH - 1, nW, gTW, gSwW, gCW, nH, gTH, gHH, gLH, gCH_, gSwH, gCH, gP, gCtx);
   gTrendW = AT24PM_Trend(gSwW, gCW, nW - 1); gTrendD = AT24PM_Trend(gSwD, gCD, nD - 1); gTrendH = AT24PM_Trend(gSwH, gCH, nH - 1);
   //--- the live plan: the last setup if its trigger is on the last closed bar (entry next open) or any target is still running
   gLive = -1; gLivePending = false; gLots = 0.0;
   if(gNp > 0)
     {
      AT24PM_Plan p = gPl[gNp - 1];
      if(p.status == 3) { gLive = gNp - 1; gLivePending = true; }
      else if(p.status == 1 && (p.st[0] == 2 || p.st[1] == 2 || p.st[2] == 2)) gLive = gNp - 1;
      if(gLive >= 0) gLots = LotsFor(MathAbs((gLivePending ? gCH_[nH - 1] : p.entry) - p.sl));
     }
   B0[0] = gTrendW; B1[0] = gCtx.stage; B2[0] = gLive >= 0 ? gPl[gLive].dir : 0;
   B3[0] = gLive >= 0 ? (gLivePending ? gCH_[nH - 1] : gPl[gLive].entry) : 0.0;
   B4[0] = gLive >= 0 ? gPl[gLive].sl : 0.0;
   double rk = gLive >= 0 ? MathAbs(B3[0] - B4[0]) : 0.0;
   B5[0] = gLive >= 0 ? B3[0] + gPl[gLive].dir * InpRR1 * rk : 0.0; B6[0] = gLive >= 0 ? B3[0] + gPl[gLive].dir * InpRR2 * rk : 0.0; B7[0] = gLive >= 0 ? B3[0] + gPl[gLive].dir * InpRR3 * rk : 0.0;
   DrawChart();
   return true;
  }

void Refresh()
  {
   datetime bar = iTime(_Symbol, PERIOD_H4, 0);
   if(gBuiltBar != bar) { if(Rebuild()) gBuiltBar = bar; }
   if(gBuiltBar != bar || gNH < 600) return;
   if(InpAlertNew && gNp > 0 && gPl[gNp - 1].trigIdx == gNH - 1 && gAlertBar != bar)
     {
      gAlertBar = bar;
      AT24PM_Plan p = gPl[gNp - 1];
      string msg = StringFormat("AT24 Position Map %s: %s plan triggered on the last closed H4 bar. Entry next open, stop %s, TP1 1:%.0f, TP2 1:%.0f, TP3 1:%.0f", _Symbol, p.dir > 0 ? "LONG" : "SHORT", DoubleToString(p.sl, _Digits), InpRR1, InpRR2, InpRR3);
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
   datetime wbar = gTW[gNW - 1];
   if(gLastWBar != wbar)
     {
      if(gLastWTrend != 99 && gLastWTrend != gTrendW && InpAlertTrend)
        {
         string msg = StringFormat("AT24 Position Map %s: the weekly trend changed from %s to %s (weekly close).", _Symbol, TrendTxt(gLastWTrend), TrendTxt(gTrendW));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      gLastWBar = wbar; gLastWTrend = gTrendW;
     }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS); SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS);
   SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS); SetIndexBuffer(5, B5, INDICATOR_CALCULATIONS); SetIndexBuffer(6, B6, INDICATOR_CALCULATIONS); SetIndexBuffer(7, B7, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true); ArraySetAsSeries(B5, true); ArraySetAsSeries(B6, true); ArraySetAsSeries(B7, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Position Map");
   if(InpSwingW < 1 || InpSwingW > 5 || InpSwingD < 1 || InpSwingD > 8 || InpSwingH < 1 || InpSwingH > 8 || InpMinSwingAtr < 0.0 || InpMinSwingAtr > 5.0 || InpMinRetrace < 0.1 || InpMinRetrace > 0.9 ||
      InpStopBufAtr < 0.0 || InpStopBufAtr > 3.0 || InpRR1 < 0.5 || InpRR2 < InpRR1 || InpRR3 < InpRR2 || InpRR3 > 20.0 || InpTimeStopWeeks < 1 || InpTimeStopWeeks > 52 || InpCost < 0.0 ||
      InpRiskPercent <= 0.0 || InpRiskPercent > 10.0 || InpH4Bars < 1000 || InpH4Bars > 12000 || InpWeeklyBars < 100 || InpWeeklyBars > 1000 || InpDrawPlans < 0)
     {
      Print("AT24 Position Map: swing bars W 1-5, D/H4 1-8; min swing 0-5 ATR; retrace 0.1-0.9; stop buffer 0-3 ATR; targets ascending (0.5-20); time stop 1-52 weeks; risk 0-10 %; H4 bars 1000-12000; weekly bars 100-1000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   gSc[0].n = 0; gSc[1].n = 0; gSc[2].n = 0;
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
