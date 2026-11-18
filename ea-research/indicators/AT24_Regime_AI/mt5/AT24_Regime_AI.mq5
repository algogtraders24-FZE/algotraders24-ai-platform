//+------------------------------------------------------------------+
//| AT24 Regime AI (MT5) v1.10                                       |
//| 1) MARKET STATE: every closed H1 bar is one of 5 learned states  |
//|    (fixed k-means centroids, no repaint) and the dashboard shows |
//|    what each state of THIS symbol was followed by (size of the   |
//|    next 24 h, with n). Size of moves, not direction.             |
//| 2) WEEKLY BIAS: the direction comes from the verified weekly     |
//|    structure rules of AT24 Position Map (HH+HL / LH+LL) and its  |
//|    H4 trigger. Arrows on the chart = those plans, nothing else.  |
//| Places no trades. Not a prediction, not advice.                  |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.30"
#property description "AT24 Regime AI - 5 learned market states on H1 (size of the next 24 h, with n) plus the weekly-structure bias and H4 trigger of AT24 Position Map: direction, entry, stop, target, arrows on the chart."
#property description "The state says how big moves tend to be; the direction is the weekly structure rule set, not a prediction. Places no trades. Past results do not predict future results. Not financial advice."
#property indicator_separate_window
#property indicator_buffers 9
#property indicator_plots   1
#property indicator_minimum 0
#property indicator_maximum 1
#property indicator_type1   DRAW_COLOR_HISTOGRAM
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2
#property indicator_color1  C'120,130,145',C'230,140,60',C'60,190,110',C'80,160,230',C'180,120,220'
#property indicator_label1  "AT24 state"

#include "AT24_RA_Core.mqh"
#include "AT24_PM_Core.mqh"
#include "AT24_RA_Plan.mqh"
#include "AT24_RA_Range.mqh"

#resource "ra_logo56.bmp"

enum ENUM_RA_STOP { RA_STOP_TURN = 0, RA_STOP_STRUCT = 1 };

input group "=== History ==="
input int    InpHistBars   = 20000;   // Closed H1 bars used for the own-history statistics
input int    InpMaxBars    = 30000;   // H1 bars read from the chart (limits the first calculation)
input group "=== Weekly bias (same rules as Position Map) ==="
input bool   InpShowBias   = true;    // Show the weekly bias and the H4 trigger
input bool   InpDrawArrows = true;    // Draw buy / sell arrows at the plan entries
input bool   InpDrawLevels = true;    // Draw entry / stop / TP1 lines of the running plan (off = no lines on the chart)
input int    InpSwingW     = 2;       // Swing bars each side: weekly
input int    InpSwingH     = 3;       // Swing bars each side: H4 (entry)
input double InpMinSwingAtr = 0.75;   // Smallest swing in ATR(14) of its timeframe
input double InpMinRetrace = 0.382;   // Smallest pullback as a share of the last weekly leg
input double InpStopBufAtr = 0.25;    // Stop buffer beyond the pullback extreme in ATR(14) of H4
input double InpRR1        = 3.0;     // Target 1 as a multiple of the risk (1:3)
input int    InpTimeStopWeeks = 8;    // Weeks before a plan that hit neither stop nor target is closed
input bool   InpUseSwap    = true;    // Include the broker swap of the holding time in the record
input ENUM_RA_STOP InpStopMode = RA_STOP_TURN; // Stop: beyond the H4 turn (tight) or beyond the weekly pullback extreme (Position Map, wide)
input double InpRiskPercent = 0.5;    // Risk per plan for the lot size shown, percent of balance
input int    InpFreshDays  = 10;      // A running plan older than this many days is shown as OLD (no chart lines, no buffer direction)
input group "=== Alerts (bar close) ==="
input bool   InpAlertChange  = false; // Alert when the market state changes on a closed H1 bar
input bool   InpAlertTrigger = false; // Alert when the weekly-bias plan triggers on a closed H4 bar
input bool   InpAlertPush    = false; // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash    = true;   // Show dashboard
input bool   InpDashInTester = false; // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX       = 10;     // Dashboard X offset
input int    InpDashY       = 20;     // Dashboard Y offset

double B_hist[], B_col[], B_state[], B_run[], B_ratio[], B_bias[], B_rmid[], B_rlo[], B_rhi[];
AT24RR_Out gR;
string PFX = "AT24RA_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
datetime gLastBar = 0, gLastH4 = 0;
int    gLastState = -2;
AT24RA_Stat gStat;
int    gStateNow = -1, gRunNow = 0;
bool   gHaveStat = false;

//--- weekly bias snapshot
struct Bias
  {
   bool   ok;            // history read and chain built
   int    trendW;        // +1 / -1 / 0
   int    stage, dir;
   double depth, B;
   bool   live, pending;
   double entry, sl, tp1, risk, atrW;
   int    n3; double avg3, p3;
   int    nPlans;
   datetime entryTime;   // H4 open of the entry bar (pending: of the bar after the trigger)
   double cur;           // last closed H1 close
   int    ageD;          // days since entry
   bool   fresh;         // pending or younger than InpFreshDays
   double lots;          // lots for InpRiskPercent
  };
Bias gB;
datetime gAlertH4 = 0;

#define DASH_W 520
#define DASH_H 398

color StateColor(const int s)
  {
   switch(s)
     {
      case 0: return C'120,130,145';
      case 1: return C'230,140,60';
      case 2: return C'60,190,110';
      case 3: return C'80,160,230';
      case 4: return C'180,120,220';
     }
   return clrSlateGray;
  }
string StateShort(const int s)
  {
   switch(s) { case 0: return "NOISY"; case 1: return "SWING"; case 2: return "STRONG"; case 3: return "COMPRESS"; case 4: return "STEADY"; }
   return "-";
  }

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - DASH_W - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - DASH_H - InpDashY) : InpDashY;
  }

void MakeLabel(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false, const string font = "")
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetString(0, n, OBJPROP_FONT, font != "" ? font : (bold ? "Segoe UI Black" : "Segoe UI"));
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, n, OBJPROP_TEXT, txt == "" ? " " : txt);
  }

//--- a rectangle with a 3D bevel: raised (buttons, cards) or sunken (wells)
void Rect(const string name, const int x, const int y, const int w, const int h, const color bg, const ENUM_BORDER_TYPE bt, const color border)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, MathMax(h, 1));
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, bt);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

color Mix(const color a, const color b, const double t)
  {
   int ar = a & 0xFF, ag = (a >> 8) & 0xFF, ab = (a >> 16) & 0xFF;
   int br = b & 0xFF, bgc = (b >> 8) & 0xFF, bb = (b >> 16) & 0xFF;
   int r = (int)(ar + (br - ar) * t), g = (int)(ag + (bgc - ag) * t), u = (int)(ab + (bb - ab) * t);
   return (color)(r | (g << 8) | (u << 16));
  }

//--- creation order = drawing order: every rectangle first, labels after
void BuildFrame()
  {
   CalcBase();
   Rect("shadow", 6, 6, DASH_W, DASH_H, C'2,4,10', BORDER_FLAT, C'2,4,10');
   Rect("bg", 0, 0, DASH_W, DASH_H, C'14,26,48', BORDER_RAISED, C'110,130,175');
   Rect("hd", 4, 4, DASH_W - 8, 62, C'26,50,96', BORDER_RAISED, C'120,150,210');
   Rect("hd2", 4, 4, DASH_W - 8, 8, C'44,78,140', BORDER_FLAT, C'44,78,140');
   Rect("cardL", 10, 74, 250, 96, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   Rect("cardR", 270, 74, 240, 96, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   Rect("mt", 10, 178, 500, 126, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   for(int q = 0; q < AT24RA_K; q++)
     {
      if(ObjectFind(0, PFX + "mg" + IntegerToString(q)) < 0) Rect("mg" + IntegerToString(q), 0, 0, 1, 1, C'200,160,60', BORDER_FLAT, C'200,160,60');
      if(ObjectFind(0, PFX + "mc" + IntegerToString(q)) < 0) Rect("mc" + IntegerToString(q), 0, 0, 1, 1, StateColor(q), BORDER_RAISED, StateColor(q));
     }
   Rect("pl", 10, 310, 500, 56, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ra_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 8);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 7);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string RatioTxt(const AT24RA_Stat &s, const int k)
  {
   if(s.ratio[k] <= 0.0) return "-";
   return StringFormat("x%.2f", s.ratio[k]);
  }

//--- broker swap as a COST in price units per calendar day (positive = cost); same as the Position Map
double SwapCostPerDay(const bool isLong)
  {
   if(!InpUseSwap) return 0.0;
   double sw = SymbolInfoDouble(_Symbol, isLong ? SYMBOL_SWAP_LONG : SYMBOL_SWAP_SHORT);
   long mode = SymbolInfoInteger(_Symbol, SYMBOL_SWAP_MODE);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), pt = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double cost = 0.0;
   if(mode == SYMBOL_SWAP_MODE_POINTS) cost = -sw * pt;
   else if(mode == SYMBOL_SWAP_MODE_CURRENCY_SYMBOL || mode == SYMBOL_SWAP_MODE_CURRENCY_MARGIN || mode == SYMBOL_SWAP_MODE_CURRENCY_DEPOSIT) { if(tv > 0.0 && ts > 0.0) cost = -sw / (tv / ts); }
   else if(mode == SYMBOL_SWAP_MODE_INTEREST_CURRENT || mode == SYMBOL_SWAP_MODE_INTEREST_OPEN) cost = -sw / 100.0 * SymbolInfoDouble(_Symbol, SYMBOL_BID) / 365.0;
   return cost * 9.0 / 7.0;
  }

void DelChartObjects()
  {
   ObjectsDeleteAll(0, PFX + "ar");
   ObjectsDeleteAll(0, PFX + "lv");
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

//--- weekly bias: the same chain as the Position Map / Position Scanner (unchanged core)
void BuildBias()
  {
   gB.ok = false; gB.live = false; gB.pending = false; gB.nPlans = 0; gB.fresh = false; gB.ageD = 0; gB.lots = 0.0; gB.entryTime = 0; gB.cur = 0.0;
   MqlRates rw[], rh[];
   int nW = CopyRates(_Symbol, PERIOD_W1, 1, 400, rw);
   int nH = CopyRates(_Symbol, PERIOD_H4, 1, 4500, rh);
   if(nW < 60 || nH < 600) return;
   datetime tW[], tH[]; double hW[], lW[], cW[], oH[], hH[], lH[], cH[], aW[], aH[];
   ArrayResize(tW, nW); ArrayResize(hW, nW); ArrayResize(lW, nW); ArrayResize(cW, nW);
   ArrayResize(tH, nH); ArrayResize(oH, nH); ArrayResize(hH, nH); ArrayResize(lH, nH); ArrayResize(cH, nH);
   for(int i = 0; i < nW; i++) { tW[i] = rw[i].time; hW[i] = rw[i].high; lW[i] = rw[i].low; cW[i] = rw[i].close; }
   for(int i = 0; i < nH; i++) { tH[i] = rh[i].time; oH[i] = rh[i].open; hH[i] = rh[i].high; lH[i] = rh[i].low; cH[i] = rh[i].close; }
   double cost = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(cost < 0.0) cost = 0.0;
   AT24PM_Params p;
   p.kW = InpSwingW; p.kD = 3; p.kH = InpSwingH; p.minSwingAtr = InpMinSwingAtr; p.minRetrace = InpMinRetrace; p.stopBufAtr = InpStopBufAtr;
   p.rr1 = InpRR1; p.rr2 = InpRR1 + 1.0; p.rr3 = InpRR1 + 2.0; p.timeStopWeeks = InpTimeStopWeeks; p.cost = cost; p.swapLong = SwapCostPerDay(true); p.swapShort = SwapCostPerDay(false);
   AT24PM_Atr(nW, hW, lW, cW, aW); AT24PM_Atr(nH, hH, lH, cH, aH);
   AT24PM_Swing sW[], sH[];
   int cW_ = AT24PM_Swings(nW, hW, lW, cW, aW, p.kW, p.minSwingAtr, sW);
   int cH_ = AT24PM_Swings(nH, hH, lH, cH, aH, p.kH, p.minSwingAtr, sH);
   AT24PM_Plan pl[]; int np = AT24PM_Run(nW, tW, hW, lW, cW, nH, tH, oH, hH, lH, cH, p, pl);
   AT24PM_Plan use[];
   if(InpStopMode == RA_STOP_TURN)
     {
      double tpx[]; int tbr[];
      AT24RA_TightPlans(np, pl, nW, tW, sW, cW_, nH, tH, hH, lH, cH, sH, cH_, aH, p, use, tpx, tbr);
     }
   else { ArrayResize(use, np); for(int k = 0; k < np; k++) use[k] = pl[k]; }
   AT24PM_Score sc; AT24PM_ScoreOf(use, np, 20261117, false, 0, sc);
   AT24PM_Ctx x; AT24PM_Eval(nH - 1, nW, tW, sW, cW_, nH, tH, hH, lH, cH, sH, cH_, p, x);
   gB.trendW = AT24PM_Trend(sW, cW_, nW - 1);
   gB.stage = x.stage; gB.dir = x.dir; gB.depth = x.depth; gB.B = x.B; gB.atrW = aW[nW - 1];
   gB.entry = 0.0; gB.sl = 0.0; gB.tp1 = 0.0; gB.risk = 0.0;
   if(np > 0)
     {
      AT24PM_Plan q = use[np - 1];
      if(q.status == 3) { gB.live = true; gB.pending = true; }
      else if(q.status == 1 && (q.st[0] == 2 || q.st[1] == 2 || q.st[2] == 2)) gB.live = true;
      if(gB.live)
        {
         gB.entry = gB.pending ? cH[nH - 1] : q.entry; gB.sl = q.sl; gB.risk = MathAbs(gB.entry - q.sl);
         gB.tp1 = gB.entry + q.dir * InpRR1 * gB.risk; gB.dir = q.dir;
         int ei = gB.pending ? q.trigIdx : q.entryIdx;
         gB.entryTime = (ei >= 0 && ei < nH) ? tH[ei] : 0;
         double lc = iClose(_Symbol, PERIOD_H1, 1);
         gB.cur = lc > 0.0 ? lc : cH[nH - 1];
         datetime lt = iTime(_Symbol, PERIOD_H1, 1);
         gB.ageD = (gB.pending || gB.entryTime == 0 || lt == 0) ? 0 : (int)MathMax(0, (lt - gB.entryTime) / 86400);
         gB.fresh = gB.pending || gB.ageD <= InpFreshDays;
         gB.lots = LotsFor(gB.risk);
        }
     }
   gB.n3 = sc.n; gB.avg3 = sc.avgR; gB.p3 = sc.pFlip; gB.nPlans = np;
   gB.ok = true;
   //--- arrows: one per plan (the last 60), at the H4 bar where the entry happens (or will happen)
   DelChartObjects();
   if(InpDrawArrows)
     {
      int from = MathMax(0, np - 60);
      for(int k = from; k < np; k++)
        {
         AT24PM_Plan q = use[k];
         if(q.status != 1 && q.status != 3) continue;
         int ix = (q.status == 3) ? q.trigIdx : q.entryIdx;
         if(ix < 0 || ix >= nH) continue;
         datetime tt = (q.status == 3) ? tH[ix] + 4 * 3600 : tH[ix];
         double off = MathMax(aH[ix] * 0.6, _Point * 10);
         double px = (q.dir > 0) ? lH[ix] - off : hH[ix] + off;
         string an = PFX + "ar" + IntegerToString(k);
         ObjectCreate(0, an, q.dir > 0 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, tt, px);
         ObjectSetInteger(0, an, OBJPROP_COLOR, q.dir > 0 ? clrLimeGreen : clrTomato);
         ObjectSetInteger(0, an, OBJPROP_WIDTH, 4);
         ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, an, OBJPROP_HIDDEN, true);
         ObjectSetString(0, an, OBJPROP_TOOLTIP, StringFormat("AT24 weekly-structure plan: %s, stop %s", q.dir > 0 ? "LONG" : "SHORT", DoubleToString(q.sl, _Digits)));
        }
      if(InpDrawLevels && gB.live && gB.fresh)
        {
         string nm[3] = {"entry", "stop", "tp1"}; double pr[3] = {gB.entry, gB.sl, gB.tp1};
         color cl[3] = {clrGold, clrTomato, clrLimeGreen};
         for(int k = 0; k < 3; k++)
           {
            string ln = PFX + "lv" + nm[k];
            ObjectCreate(0, ln, OBJ_HLINE, 0, 0, pr[k]);
            ObjectSetInteger(0, ln, OBJPROP_COLOR, cl[k]);
            ObjectSetInteger(0, ln, OBJPROP_STYLE, STYLE_DASH);
            ObjectSetInteger(0, ln, OBJPROP_WIDTH, 1);
            ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
            ObjectSetInteger(0, ln, OBJPROP_HIDDEN, true);
            ObjectSetString(0, ln, OBJPROP_TOOLTIP, StringFormat("%s %s", nm[k], DoubleToString(pr[k], _Digits)));
           }
        }
     }
  }

string StageTxt(color &c)
  {
   c = clrSilver;
   if(gB.live && gB.pending) { c = clrGold; return StringFormat("TRIGGER: %s, entry next open", gB.dir > 0 ? "LONG" : "SHORT"); }
   if(gB.live && !gB.fresh) { c = clrSlateGray; return StringFormat("old %s plan still open (%d d)", gB.dir > 0 ? "long" : "short", gB.ageD); }
   if(gB.live) { c = clrSilver; return StringFormat("%s plan running (%d d)", gB.dir > 0 ? "long" : "short", gB.ageD); }
   if(gB.trendW == 0) { c = clrSlateGray; return "weekly range: no trade"; }
   switch(gB.stage)
     {
      case 1: return StringFormat("waiting for a pullback (%.0f %%)", MathMax(0.0, gB.depth) * 100.0);
      case 2: return StringFormat("pullback %.0f %%: wait H4 turn", gB.depth * 100.0);
      case 3: c = clrGold; return StringFormat("H4 turn: close %s %s", gB.dir > 0 ? "above" : "below", DoubleToString(gB.B, _Digits));
      case 4: c = clrSlateGray; return "trigger already used: wait for the next turn";
     }
   return "";
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 72, 10, "AT24 REGIME AI", C'255,214,110', 14, true);
   MakeLabel("t2", 72, 38, "market state  +  weekly bias", C'170,190,225', 9);
   if(_Period != PERIOD_H1)
     {
      MakeLabel("w1", 18, 100, "Trained on H1. Open this on an H1 chart.", clrGold, 11, true);
      return;
     }
   if(!gHaveStat || gStateNow < 0)
     {
      MakeLabel("w1", 18, 100, "Not enough history (needs 200+ bars).", clrGold, 11, true);
      return;
     }
   ObjectDelete(0, PFX + "w1");
   int k = gStateNow;
   //--- left card: market state
   MakeLabel("c1", 18, 78, "MARKET STATE", C'255,214,110', 8, true);
   MakeLabel("c2", 18, 94, AT24RA_Name(k), StateColor(k), 17, true);
   MakeLabel("c3", 18, 122, StringFormat("for %d bar%s    stays next bar %.0f %%", gRunNow, gRunNow == 1 ? "" : "s", gStat.pStay[k] * 100.0), clrSilver, 8);
   if(gR.ok)
     {
      MakeLabel("c4", 18, 138, StringFormat("next 24 h range ~ %s  (%.2f %%)", DoubleToString(gR.mid, _Digits), gR.midPct), clrSilver, 8, true);
      MakeLabel("c5", 18, 153, StringFormat("80 %% band %s - %s   held %.0f %%", DoubleToString(gR.lo, _Digits), DoubleToString(gR.hi, _Digits), gR.cover * 100.0), clrSlateGray, 8);
     }
   else
     {
      MakeLabel("c4", 18, 138, StringFormat("next 24 h range here: %s  (n %d)", RatioTxt(gStat, k), gStat.nf[k]), clrSilver, 8);
      MakeLabel("c5", 18, 153, " ", clrSlateGray, 8);
     }
   //--- right card: weekly bias
   MakeLabel("b1", 278, 78, "WEEKLY BIAS", C'255,214,110', 8, true);
   if(InpShowBias && gB.ok)
     {
      color bc = gB.trendW > 0 ? clrLimeGreen : (gB.trendW < 0 ? clrTomato : clrSlateGray);
      string arrow = gB.trendW > 0 ? ShortToString(0x25B2) + "  UP" : (gB.trendW < 0 ? ShortToString(0x25BC) + "  DOWN" : ShortToString(0x25A0) + "  RANGE");
      MakeLabel("b2", 278, 94, arrow, bc, 17, true, "Segoe UI Symbol");
      color sc2; string stg = StageTxt(sc2);
      MakeLabel("b3", 278, 128, stg, sc2, 8, gB.live && gB.pending);
      string md = (InpStopMode == RA_STOP_TURN) ? "tight stop, 1:3" : "weekly stop, 1:3";
      string rec = (gB.n3 < 30) ? StringFormat("%s: %+.2f R (%d)", md, gB.avg3, gB.n3) : StringFormat("%s: %+.2f R  n=%d", md, gB.avg3, gB.n3);
      MakeLabel("b4", 278, 146, rec, clrSlateGray, 8);
     }
   else
     {
      MakeLabel("b2", 278, 94, InpShowBias ? "loading..." : "off", clrSlateGray, 14, true);
      MakeLabel("b3", 278, 128, "", clrSlateGray, 8);
      MakeLabel("b4", 278, 146, "", clrSlateGray, 8);
     }
   //--- meter: next 24 h range by state (columns, current state framed)
   MakeLabel("m0", 18, 182, "NEXT 24 H RANGE BY STATE  (this symbol, x1.00 = average)", C'255,214,110', 8, true);
   int base = 178 + 126 - 36;       // column baseline
   for(int q = 0; q < AT24RA_K; q++)
     {
      int sx = 22 + q * 98;
      double rt = gStat.ratio[q];
      int hh = (rt <= 0.0) ? 6 : (int)(6 + MathMax(0.0, MathMin(rt - 0.6, 0.7)) / 0.7 * 58.0);
      int cx = sx + 14;
      Rect("mg" + IntegerToString(q), cx - 3, base - hh - 3, 62 + 6, hh + 6, C'230,190,80', (q == k) ? BORDER_FLAT : BORDER_FLAT, (q == k) ? C'230,190,80' : C'8,16,30');
      Rect("mc" + IntegerToString(q), cx, base - hh, 62, hh, rt <= 0.0 ? C'50,60,80' : StateColor(q), BORDER_RAISED, Mix(StateColor(q), clrWhite, 0.45));
      MakeLabel("mn" + IntegerToString(q), sx + 12, base + 4, StateShort(q), StateColor(q), 8, true);
      MakeLabel("mv" + IntegerToString(q), sx + 12, base + 17, rt <= 0.0 ? "-" : StringFormat("%s  n%d", RatioTxt(gStat, q), gStat.nf[q]), clrSilver, 8);
     }
   //--- plan strip: levels, age and how far they are from the price now
   if(InpShowBias && gB.ok && gB.live)
     {
      color pc = !gB.fresh ? clrSlateGray : (gB.dir > 0 ? clrLimeGreen : clrTomato);
      string side = gB.dir > 0 ? "LONG" : "SHORT";
      if(gB.pending)
         MakeLabel("p1", 18, 314, StringFormat("TRIGGER %s  E ~%s  SL %s  TP1 %s", side, DoubleToString(gB.entry, _Digits), DoubleToString(gB.sl, _Digits), DoubleToString(gB.tp1, _Digits)), pc, 9, true);
      else
         MakeLabel("p1", 18, 314, StringFormat("%s%s  E %s  SL %s  TP1 %s", gB.fresh ? "" : "OLD ", side, DoubleToString(gB.entry, _Digits), DoubleToString(gB.sl, _Digits), DoubleToString(gB.tp1, _Digits)), pc, 9, true);
      double cur = gB.cur;
      string when = gB.pending ? "trigger on the last closed H4 bar, entry next open" : StringFormat("entered %s (%d d ago)   price now %s", TimeToString(gB.entryTime, TIME_DATE), gB.ageD, DoubleToString(cur, _Digits));
      MakeLabel("p2", 18, 332, when, clrSilver, 8);
      if(cur > 0.0)
         MakeLabel("p3", 18, 346, StringFormat("to SL %+.1f %%   to TP1 %+.1f %%   %.1f %% risk = %s lots", (gB.sl - cur) / cur * 100.0, (gB.tp1 - cur) / cur * 100.0, InpRiskPercent, gB.lots > 0.0 ? DoubleToString(gB.lots, 2) : "n/a"), clrSilver, 8);
     }
   else
     {
      MakeLabel("p1", 18, 314, InpShowBias ? "no plan running: arrows appear when the H4 trigger fires" : "weekly bias is off", clrSlateGray, 8);
      MakeLabel("p2", 18, 332, " ", clrSlateGray, 8);
      MakeLabel("p3", 18, 346, " ", clrSlateGray, 8);
     }
   MakeLabel("n1", 12, 372, "Size = regime. Direction = weekly structure rules.", clrSlateGray, 7);
   MakeLabel("n2", 12, 382, "Past results do not predict future results.  algotraders24.ai", clrSlateGray, 7);
   ChartRedraw(0);
  }

int OnInit()
  {
   SetIndexBuffer(0, B_hist, INDICATOR_DATA);
   SetIndexBuffer(1, B_col, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, B_state, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B_run, INDICATOR_CALCULATIONS);
   SetIndexBuffer(4, B_ratio, INDICATOR_CALCULATIONS);
   SetIndexBuffer(5, B_bias, INDICATOR_CALCULATIONS);
   SetIndexBuffer(6, B_rmid, INDICATOR_CALCULATIONS); SetIndexBuffer(7, B_rlo, INDICATOR_CALCULATIONS); SetIndexBuffer(8, B_rhi, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B_rmid, false); ArraySetAsSeries(B_rlo, false); ArraySetAsSeries(B_rhi, false);
   ArraySetAsSeries(B_hist, false); ArraySetAsSeries(B_col, false); ArraySetAsSeries(B_state, false); ArraySetAsSeries(B_run, false); ArraySetAsSeries(B_ratio, false); ArraySetAsSeries(B_bias, false);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Regime AI");
   IndicatorSetInteger(INDICATOR_DIGITS, 2);
   if(InpHistBars < 2000 || InpHistBars > 200000 || InpMaxBars < 3000 || InpMaxBars > 200000 ||
      InpSwingW < 1 || InpSwingW > 5 || InpSwingH < 1 || InpSwingH > 8 || InpMinSwingAtr < 0.0 || InpMinSwingAtr > 5.0 || InpMinRetrace < 0.1 || InpMinRetrace > 0.9 ||
      InpStopBufAtr < 0.0 || InpStopBufAtr > 3.0 || InpRiskPercent <= 0.0 || InpRiskPercent > 10.0 || InpStopMode < 0 || InpStopMode > 1 || InpFreshDays < 1 || InpFreshDays > 60 || InpRR1 < 0.5 || InpRR1 > 18.0 || InpTimeStopWeeks < 1 || InpTimeStopWeeks > 52)
     {
      Print("AT24 Regime AI: history bars 2000-200000; swing bars W 1-5, H4 1-8; min swing 0-5 ATR; retrace 0.1-0.9; stop buffer 0-3 ATR; target 0.5-18; time stop 1-52 weeks.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   gB.ok = false;
   EventSetTimer(3);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) Draw();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

//--- the weekly / H4 history of the symbol may still be loading: retry until the chain can be built
void OnTimer()
  {
   if(!InpShowBias || gB.ok || _Period != PERIOD_H1 || !gHaveStat) return;
   BuildBias();
   if(gB.ok)
     {
      gLastH4 = iTime(_Symbol, PERIOD_H4, 0);
      if(gStateNow >= 0 && gB.ok) B_bias[ArraySize(B_bias) - 2] = (gB.live && gB.fresh) ? gB.dir : 0.0;
      Draw();
     }
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 500) return 0;
   //--- only closed bars: the forming bar (last index) is excluded; recalc once per new bar
   datetime curBar = time[rates_total - 1];
   if(prev_calculated > 0 && curBar == gLastBar) return rates_total;
   gLastBar = curBar;
   int nUse = MathMin(rates_total - 1, InpMaxBars);          // closed bars to use
   int off = (rates_total - 1) - nUse;                        // first used index in the chart arrays
   double h[], l[], c[]; ArrayResize(h, nUse); ArrayResize(l, nUse); ArrayResize(c, nUse);
   for(int i = 0; i < nUse; i++) { h[i] = high[off + i]; l[i] = low[off + i]; c[i] = close[off + i]; }
   double atr[], er[], lv[], sl[], rg[], fr[]; bool ok[]; int st[];
   AT24RA_Features(nUse, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(nUse, er, lv, sl, rg, ok, st);
   AT24RA_Forward(nUse, h, l, atr, ok, fr);
   int from = MathMax(AT24RA_FIRST, nUse - InpHistBars);
   AT24RA_Stats(nUse, from, st, fr, gStat);
   datetime tt[]; ArrayResize(tt, nUse);
   for(int i = 0; i < nUse; i++) tt[i] = time[off + i];
   AT24RR_Run(nUse, from, tt, h, l, c, gR);
   for(int i = 0; i < rates_total; i++)
     {
      B_hist[i] = EMPTY_VALUE; B_col[i] = 0; B_state[i] = EMPTY_VALUE; B_run[i] = EMPTY_VALUE; B_ratio[i] = EMPTY_VALUE; B_bias[i] = EMPTY_VALUE; B_rmid[i] = EMPTY_VALUE; B_rlo[i] = EMPTY_VALUE; B_rhi[i] = EMPTY_VALUE;
     }
   int run = 0;
   for(int i = 0; i < nUse; i++)
     {
      int k = st[i]; int ci = off + i;
      if(k < 0) { run = 0; continue; }
      run = (i > 0 && st[i - 1] == k) ? run + 1 : 1;
      B_hist[ci] = 1.0; B_col[ci] = k; B_state[ci] = k; B_run[ci] = run; B_ratio[ci] = gStat.ratio[k];
     }
   if(gR.ok) { B_rmid[rates_total - 2] = gR.mid; B_rlo[rates_total - 2] = gR.lo; B_rhi[rates_total - 2] = gR.hi; }
   gStateNow = st[nUse - 1];
   gRunNow = AT24RA_RunLen(st, nUse - 1);
   gHaveStat = (gStat.nAll > 0);
   //--- weekly bias: rebuilt once per new H4 bar (and until the first successful build)
   datetime h4 = iTime(_Symbol, PERIOD_H4, 0);
   if(InpShowBias && (!gB.ok || h4 != gLastH4) && _Period == PERIOD_H1)
     {
      bool wasPend = gB.ok && gB.live && gB.pending;
      BuildBias();
      if(gB.ok) gLastH4 = h4;
      if(InpAlertTrigger && gB.ok && gB.live && gB.pending && gAlertH4 != h4)
        {
         gAlertH4 = h4;
         string msg = StringFormat("AT24 Regime AI %s: %s trigger on the last closed H4 bar, entry next open, stop %s", _Symbol, gB.dir > 0 ? "LONG" : "SHORT", DoubleToString(gB.sl, _Digits));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
     }
   if(gB.ok) B_bias[rates_total - 2] = (gB.live && gB.fresh) ? gB.dir : 0.0;     // last closed bar: running or triggered plan direction (0 = none)
   if(InpAlertChange && gLastState != -2 && gStateNow >= 0 && gStateNow != gLastState && gLastState >= 0)
     {
      string msg = StringFormat("AT24 Regime AI %s: %s -> %s", _Symbol, AT24RA_Name(gLastState), AT24RA_Name(gStateNow));
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
   gLastState = gStateNow;
   Draw();
   return rates_total;
  }
