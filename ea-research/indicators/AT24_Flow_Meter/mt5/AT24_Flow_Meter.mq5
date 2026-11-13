//+------------------------------------------------------------------+
//| AT24 Flow Meter (MT5)                                            |
//| Delta and cumulative delta per bar, with an honest label of what |
//| kind of delta it is: REAL (the feed flags buyer / seller trades),|
//| TICK-RULE ESTIMATE (price up = buy, down = sell) or BAR PROXY    |
//| (from the bar shape and tick volume). Delta divergence marks on  |
//| closed bars. Descriptive. Not a signal.                          |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Flow Meter - per-bar delta and daily cumulative delta with a clear label: real, tick-rule estimate or bar proxy. Delta divergence marks on closed bars."
#property description "On most forex and CFD feeds delta is an estimate. It places no trades and gives no signals."
#property indicator_separate_window
#property indicator_buffers 4
#property indicator_plots   2
#property indicator_label1  "Delta"
#property indicator_type1   DRAW_COLOR_HISTOGRAM
#property indicator_color1  clrLimeGreen, clrTomato, C'110,170,110', C'180,110,110'
#property indicator_width1  3
#property indicator_label2  "Cumulative delta (daily)"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrGold
#property indicator_width2  2

#include "AT24_FM_Core.mqh"

enum ENUM_AT24FM_MODE { FM_AUTO = 0, FM_BARS_ONLY = 1 };

input group "=== Delta ==="
input ENUM_AT24FM_MODE InpMode = FM_AUTO;   // Auto = ticks where the terminal has them, bar proxy for older bars
input int    InpTickBars      = 300;    // Most recent bars that use tick data (brokers keep little tick history)
input int    InpHistoryBars   = 1500;   // Bars analysed
input group "=== Divergence marks (closed bars) ==="
input bool   InpShowDiv       = true;   // Mark delta divergences on the price chart
input int    InpSwingBars     = 5;      // Bars on each side that confirm a swing point
input int    InpMinSep        = 6;      // Fewest bars between the two swings
input int    InpMaxSep        = 60;     // Most bars between the two swings
input bool   InpAlertDiv      = false;  // Alert when a divergence is confirmed on the last closed bar
input bool   InpAlertPush     = false;  // Also send a push notification

double BD[], BC[], BCUM[], BSRC[];
string PFX = "AT24FM_";
datetime gLastBar = 0, gAlertBar = 0;
string gBadge = "LOADING", gBadge2 = "";
color  gBadgeCol = clrSlateGray;
int    gTickBarsUsed = 0;
bool   gRealFeed = false;

void Lbl(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false)
  {
   int win = ChartWindowFind();
   if(win < 0) win = 1;
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, win, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetString(0, n, OBJPROP_FONT, bold ? "Segoe UI Semibold" : "Segoe UI");
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, n, OBJPROP_TEXT, txt == "" ? " " : txt);
  }

void DrawBadge()
  {
   Lbl("t2", 8, 18, gBadge, gBadgeCol, 9, true);
   Lbl("t3", 8, 34, gBadge2, clrSilver, 8);
  }

bool Rebuild(const int total)
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, _Period, 1, MathMin(MathMax(InpHistoryBars, 500), total - 1), rr);
   if(n < 300) return false;
   double o[], h[], l[], c[], delta[], cum[], rsiLike[]; long tv[]; datetime tm[]; int src[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(delta, n); ArrayResize(cum, n); ArrayResize(tv, n); ArrayResize(tm, n); ArrayResize(src, n);
   for(int i = 0; i < n; i++) { o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; c[i] = rr[i].close; tv[i] = rr[i].tick_volume; tm[i] = rr[i].time; src[i] = 0; }
   AT24FM_BarProxy(n, o, h, l, c, tv, delta);
   gTickBarsUsed = 0; gRealFeed = false;
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   if(InpMode == FM_AUTO && !tester)
     {
      int nbT = MathMin(InpTickBars, n - 1);
      int sec = PeriodSeconds();
      long t0 = (long)tm[n - nbT];
      MqlTick tk[]; int nt = CopyTicksRange(_Symbol, tk, COPY_TICKS_ALL, (ulong)t0 * 1000, (ulong)((long)tm[n - 1] + sec) * 1000 - 1);
      if(nt > 50)
        {
         long ts[]; double px[], vl[]; int fl[]; ArrayResize(ts, nt); ArrayResize(px, nt); ArrayResize(vl, nt); ArrayResize(fl, nt);
         int flagged = 0;
         for(int i = 0; i < nt; i++)
           {
            ts[i] = (long)(tk[i].time_msc / 1000);
            double mid = (tk[i].bid > 0.0 && tk[i].ask > 0.0) ? 0.5 * (tk[i].bid + tk[i].ask) : (tk[i].last > 0.0 ? tk[i].last : (tk[i].bid > 0.0 ? tk[i].bid : tk[i].ask));
            px[i] = (tk[i].last > 0.0 && (tk[i].flags & TICK_FLAG_LAST) != 0) ? tk[i].last : mid;
            vl[i] = tk[i].volume_real > 0.0 ? tk[i].volume_real : (double)tk[i].volume;
            fl[i] = 0;
            if((tk[i].flags & TICK_FLAG_BUY) != 0) fl[i] |= AT24FM_FLAG_BUY;
            if((tk[i].flags & TICK_FLAG_SELL) != 0) fl[i] |= AT24FM_FLAG_SELL;
            if(fl[i] != 0) flagged++;
           }
         gRealFeed = (flagged * 20 >= nt);                       // at least 5 % of the ticks carry a buyer / seller flag
         double dT[]; int cT[]; ArrayResize(dT, nbT); ArrayResize(cT, nbT);
         AT24FM_TickDelta(nt, ts, px, vl, fl, t0, sec, nbT, gRealFeed, dT, cT);
         for(int b = 0; b < nbT; b++) if(cT[b] > 0) { delta[n - nbT + b] = dT[b]; src[n - nbT + b] = gRealFeed ? 2 : 1; gTickBarsUsed++; }
        }
     }
   AT24FM_CumDaily(n, tm, delta, cum);
   //--- buffers (non-series, newest bar = last index of the chart arrays)
   int off = total - n;
   for(int j = 0; j < total; j++) { BD[j] = 0.0; BC[j] = 0.0; BCUM[j] = EMPTY_VALUE; BSRC[j] = 0.0; }
   for(int i = 0; i < n; i++)
     {
      int j = off + i;
      BD[j] = delta[i]; BCUM[j] = cum[i]; BSRC[j] = src[i];
      bool up = delta[i] >= 0.0;
      BC[j] = (src[i] == 0) ? (up ? 2.0 : 3.0) : (up ? 0.0 : 1.0);
     }
   //--- badge
   if(InpMode == FM_BARS_ONLY || gTickBarsUsed == 0)
     { gBadge = "BAR PROXY (estimate)"; gBadgeCol = clrOrange; gBadge2 = "from bar shape and tick volume; no tick data used"; }
   else if(gRealFeed)
     { gBadge = "REAL delta (feed flags buyer/seller)"; gBadgeCol = clrLimeGreen; gBadge2 = StringFormat("last %d bars from flagged ticks, older bars: bar proxy", gTickBarsUsed); }
   else
     { gBadge = "TICK-RULE ESTIMATE"; gBadgeCol = clrGold; gBadge2 = StringFormat("last %d bars: price up = buy; older: bar proxy", gTickBarsUsed); }
   //--- delta divergence on closed bars: price swings versus the cumulative delta at the swings
   ObjectsDeleteAll(0, PFX + "v");
   AT24DV_Ev ev[]; int ne = AT24DV_Events(n, h, l, cum, InpSwingBars, InpMinSep, InpMaxSep, 0.0, ev);
   if(InpShowDiv)
     {
      int from = MathMax(0, ne - 8);
      for(int e = from; e < ne; e++)
        {
         bool bull = ev[e].dir > 0;
         string na = PFX + "v" + IntegerToString(e);
         ObjectCreate(0, na, bull ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, tm[ev[e].idx], bull ? l[ev[e].p] : h[ev[e].p]);
         ObjectSetInteger(0, na, OBJPROP_COLOR, bull ? clrDeepSkyBlue : clrOrange); ObjectSetInteger(0, na, OBJPROP_SELECTABLE, false); ObjectSetInteger(0, na, OBJPROP_HIDDEN, true);
        }
     }
   if(ne > 0 && ev[ne - 1].idx == n - 1 && InpAlertDiv && gAlertBar != tm[n - 1])
     {
      gAlertBar = tm[n - 1];
      string msg = StringFormat("AT24 Flow Meter %s: %s delta divergence confirmed (%s)", _Symbol, ev[ne - 1].dir > 0 ? "BULLISH" : "BEARISH", gBadge);
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
   return true;
  }

int OnInit()
  {
   SetIndexBuffer(0, BD, INDICATOR_DATA); SetIndexBuffer(1, BC, INDICATOR_COLOR_INDEX); SetIndexBuffer(2, BCUM, INDICATOR_DATA); SetIndexBuffer(3, BSRC, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(BD, false); ArraySetAsSeries(BC, false); ArraySetAsSeries(BCUM, false); ArraySetAsSeries(BSRC, false);
   PlotIndexSetInteger(1, PLOT_DRAW_BEGIN, 0);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Flow Meter");
   IndicatorSetInteger(INDICATOR_DIGITS, 1);
   if(InpTickBars < 5 || InpTickBars > 5000 || InpHistoryBars < 500 || InpHistoryBars > 20000 || InpSwingBars < 2 || InpSwingBars > 20 || InpMinSep < 2 || InpMaxSep < InpMinSep)
     {
      Print("AT24 Flow Meter: tick bars 5-5000, history 500-20000, swing bars 2-20, separation min 2 and max above min.");
      return INIT_PARAMETERS_INCORRECT;
     }
   EventSetTimer(5);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer() { DrawBadge(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 600) return 0;
   datetime lastClosed = time[rates_total - 2];
   if(prev_calculated == 0 || gLastBar != lastClosed)
     {
      if(Rebuild(rates_total)) gLastBar = lastClosed;
      DrawBadge();
     }
   return rates_total;
  }
