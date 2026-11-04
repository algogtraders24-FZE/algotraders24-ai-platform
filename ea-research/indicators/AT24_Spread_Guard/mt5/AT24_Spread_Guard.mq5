//+------------------------------------------------------------------+
//| AT24 Spread Guard (MT5)                                          |
//| See what trading costs, hour by hour - and when it spikes.       |
//| Context tool. Not a signal.                                      |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Spread Guard - spread by GMT hour, live spread vs typical, cost as % of ATR."
#property description "Uses the spread recorded on your broker's bars. Context tool. Not a signal."
#property indicator_separate_window
#property indicator_buffers 3
#property indicator_plots   2
#property indicator_minimum 0

#property indicator_label1  "Bar spread (points)"
#property indicator_type1   DRAW_COLOR_HISTOGRAM
#property indicator_color1  clrDimGray,clrLimeGreen,clrOrange,clrTomato
#property indicator_width1  2

#property indicator_label2  "Typical for this hour"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrGold
#property indicator_width2  1

#include "AT24_SpreadGuard_Core.mqh"
#include "AT24_ServerClock.mqh"

#resource "sg_logo56.bmp"

input group "=== Profile ==="
input int    InpDays          = 20;     // Days of history for the hourly profile
input double InpOKMult        = 1.25;   // Spread up to this x typical = normal
input double InpSpikeMult     = 2.00;   // Above this x typical = spike
input double InpMaxCostATR    = 0.15;   // Warn when spread / ATR(14) is above this
input group "=== Time zone ==="
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (recommended)
input bool   InpAutoOffset    = true;   // Fallback: detect the current server offset from GMT
input int    InpOffsetHours   = 0;      // Fallback: manual server offset in hours (if auto is off)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts ==="
input bool   InpAlertSpike    = false;  // Alert when spread turns into a SPIKE
input bool   InpAlertPush     = false;  // Also send push notification

double BufSp[], BufCol[], BufAvg[];
double gAvg[]; int gCnt[];
double gLSum[24]; long gLCnt[24];
datetime gLastSample = 0, gLastSave = 0;
bool gLive = false, gFlat = false;
int    gUsed = 0, gLastTotal = 0, gLastStatus = 0;
datetime gLastAlert = 0;
bool   gDash = false;
string PFX = "AT24SG_";

#define DASH_W 300
#define DASH_H 252
int gBaseX = 0, gBaseY = 0;

int ServerOffsetSec()
  {
   if(!InpAutoOffset) return InpOffsetHours * 3600;
   return (int)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;
  }

//--- DST-aware broker clock (AT24_ServerClock.mqh). Falls back to the constant offset when detection fails.
AT24SC_Clock gClk;
bool     gUsedClock = false;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

void RefreshClock()
  {
   if(!InpDstAware) { gClk.ok = false; return; }
   //--- detected: refresh once an hour; not detected (H1 history still loading): retry every 10 seconds
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_Detect(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
  }

bool UseClock() { return (InpDstAware && gClk.ok); }

datetime ToGmt(const datetime serverTime)
  {
   if(UseClock()) return AT24SC_ToGmt(gClk, serverTime);
   return serverTime - (datetime)ServerOffsetSec();
  }

string ClockName()
  {
   if(!UseClock()) return "fixed offset";
   return gClk.rule == AT24SC_US ? "US DST" : (gClk.rule == AT24SC_EU ? "EU DST" : "no DST");
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

color StatusColor(const int s)
  {
   switch(s)
     {
      case 1: return clrLimeGreen;
      case 2: return clrOrange;
      case 3: return clrTomato;
     }
   return clrSlateGray;
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

void MakeRect(const string name, const int x, const int y, const int w, const int h, const color bg, const color border)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

void BuildDashFrame()
  {
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40', C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sg_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

double CurrentATR(const int total, const double &high[], const double &low[], const double &close[])
  {
   if(total < 20) return 0.0;
   double s = 0.0;
   for(int i = total - 15; i <= total - 2; i++)   // 14 closed bars
      s += MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
   return s / 14.0;
  }

string GVName(const int h, const bool cnt) { return "AT24SG_" + _Symbol + "_" + IntegerToString(h) + (cnt ? "_n" : "_s"); }

long LiveTotal() { long t = 0; for(int h = 0; h < 24; h++) t += gLCnt[h]; return t; }

void LoadLive()
  {
   for(int h = 0; h < 24; h++)
     {
      gLSum[h] = GlobalVariableCheck(GVName(h, false)) ? GlobalVariableGet(GVName(h, false)) : 0.0;
      gLCnt[h] = GlobalVariableCheck(GVName(h, true)) ? (long)GlobalVariableGet(GVName(h, true)) : 0;
     }
  }

void SaveLive()
  {
   for(int h = 0; h < 24; h++) { GlobalVariableSet(GVName(h, false), gLSum[h]); GlobalVariableSet(GVName(h, true), (double)gLCnt[h]); }
  }

//--- history profile is replaced hour by hour once the live profile has >= 20 samples there and >= 12 hours are covered
void ApplyLive()
  {
   int covered = 0;
   for(int h = 0; h < 24; h++) if(gLCnt[h] >= 20) covered++;
   gLive = (covered >= 12);
   if(!gLive) return;
   for(int h2 = 0; h2 < 24; h2++)
      if(gLCnt[h2] >= 20) { gAvg[h2] = gLSum[h2] / (double)gLCnt[h2]; gCnt[h2] = (int)MathMin((long)2000000000, gLCnt[h2]); }
  }

bool IsFlat()
  {
   double mn = 1e18, mx = 0.0, sm = 0.0; int n = 0;
   for(int h = 0; h < 24; h++) if(gCnt[h] >= 5 && gAvg[h] > 0.0) { mn = MathMin(mn, gAvg[h]); mx = MathMax(mx, gAvg[h]); sm += gAvg[h]; n++; }
   if(n < 12) return false;
   return (mx - mn) / (sm / n) < 0.10;
  }

void UpdateDash(const int status, const double spreadNow, const double hourAvg, const double atr, const int gmtHour)
  {
   if(!gDash) return;
   BuildDashFrame();
   double spreadPrice = spreadNow * _Point;
   double costPct = (atr > 0.0) ? 100.0 * spreadPrice / atr : 0.0;
   bool costBad = (atr > 0.0 && spreadPrice / atr > InpMaxCostATR);
   string cheap, costly;
   AT24SG_Extremes(gAvg, gCnt, cheap, costly);
   if(gFlat && !gLive) { cheap = "learning live..."; costly = "learning live..."; }

   MakeLabel("t1", 70, 6, "AT24 SPREAD GUARD", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, AT24SG_StatusName(status), StatusColor(status), 11, true);
   MakeLabel("l1", 10, 68, StringFormat("Spread now            %.0f pts", spreadNow), clrWhite, 9);
   MakeLabel("l2", 10, 84, StringFormat("Typical at %02d:00 GMT   %.1f pts", gmtHour, hourAvg), clrWhite, 9);
   MakeLabel("l3", 10, 100, StringFormat("Spread / ATR(14)      %.1f%%  %s", costPct, costBad ? "HIGH COST" : "ok"), costBad ? clrTomato : clrWhite, 9);
   MakeLabel("l4", 10, 116, "Cheapest hours (GMT)   " + cheap, clrLimeGreen, 9);
   MakeLabel("l5", 10, 132, "Costliest hours (GMT)  " + costly, clrTomato, 9);

   string src = gLive ? "Profile: LIVE ticks (" + IntegerToString((int)LiveTotal()) + " samples)" : (gFlat ? "Profile: history is FLAT on this feed - learning live..." : "Profile: bar history (" + IntegerToString(gUsed) + " bars)");
   MakeLabel("l6", 10, 148, src, gLive ? clrLimeGreen : clrGold, 8);

   //--- 24h mini chart of the hourly profile
   double med = AT24SG_MedianAvg(gAvg, gCnt);
   double mx = 0.0;
   for(int h = 0; h < 24; h++) mx = MathMax(mx, gAvg[h]);
   int baseY = 212, maxH = 40;
   for(int h2 = 0; h2 < 24; h2++)
     {
      int bh = (mx > 0.0 && gCnt[h2] > 0) ? (int)MathMax(2.0, maxH * gAvg[h2] / mx) : 1;
      color c = clrSlateGray;
      if(gCnt[h2] >= 5 && med > 0.0) c = (gAvg[h2] <= med * 1.0) ? clrLimeGreen : (gAvg[h2] <= med * 1.5 ? clrOrange : clrTomato);
      if(gFlat && !gLive) c = clrSlateGray;
      if(h2 == gmtHour) c = clrGold;
      MakeRect("b" + IntegerToString(h2), 12 + h2 * 11, baseY - bh, 9, bh, c, c);
     }
   MakeLabel("a0", 10, 214, "00", clrSlateGray, 7);
   MakeLabel("a6", 78, 214, "06", clrSlateGray, 7);
   MakeLabel("a12", 144, 214, "12", clrSlateGray, 7);
   MakeLabel("a18", 210, 214, "18", clrSlateGray, 7);
   MakeLabel("ft", 10, 232, StringFormat("Gold bar = now. Clock: %s. Context tool. algotraders24.ai", ClockName()), clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, BufSp, INDICATOR_DATA);
   SetIndexBuffer(1, BufCol, INDICATOR_COLOR_INDEX);
   SetIndexBuffer(2, BufAvg, INDICATOR_DATA);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetDouble(1, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Spread Guard");
   IndicatorSetInteger(INDICATOR_DIGITS, 0);
   if(InpDays < 3 || InpSpikeMult <= InpOKMult)
     {
      Print("AT24 Spread Guard: days must be >= 3 and spike multiple above the normal multiple.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   LoadLive();
   if(gDash) BuildDashFrame();
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildDashFrame();
  }

void OnDeinit(const int reason)
  {
   SaveLive();
   ObjectsDeleteAll(0, PFX);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 50) return 0;
   RefreshClock();
   if(prev_calculated == 0 || rates_total != gLastTotal || UseClock() != gUsedClock)
     {
      gLastTotal = rates_total;
      gUsedClock = UseClock();
      //--- the profile works on GMT hours (offset 0); the window below converts every bar with the DST-aware clock
      int nbw = (int)MathMin((double)rates_total, (double)((InpDays + 2) * 86400 / MathMax(1, PeriodSeconds(_Period)) + 100));
      int basew = rates_total - nbw;
      datetime tg[]; int spw[];
      ArrayResize(tg, nbw); ArrayResize(spw, nbw);
      for(int q = 0; q < nbw; q++) { tg[q] = ToGmt(time[basew + q]); spw[q] = spread[basew + q]; }
      gUsed = AT24SG_Profile(nbw, tg, spw, 0, InpDays, gAvg, gCnt);
      gFlat = IsFlat();
     }
   //--- learn the live spread (one sample every 2 s, saved every minute)
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   if(!tester && TimeCurrent() - gLastSample >= 2)
     {
      MqlDateTime lg; TimeToStruct(ToGmt(TimeCurrent()), lg);
      double sn = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
      if(sn > 0.0) { gLSum[lg.hour] += sn; gLCnt[lg.hour]++; }
      gLastSample = TimeCurrent();
      if(TimeCurrent() - gLastSave >= 60) { SaveLive(); gLastSave = TimeCurrent(); }
     }
   ApplyLive();
   int first = (prev_calculated > 1) ? prev_calculated - 1 : 0;
   if(first == 0)
     {
      ArrayInitialize(BufSp, EMPTY_VALUE);
      ArrayInitialize(BufAvg, EMPTY_VALUE);
      ArrayInitialize(BufCol, 0);
     }
   for(int i = MathMax(first, rates_total - 15000); i < rates_total; i++)
     {
      int hh = AT24SG_HourOf(ToGmt(time[i]), 0);
      double sp = (double)spread[i];
      BufSp[i] = (sp > 0.0) ? sp : EMPTY_VALUE;
      BufAvg[i] = (gAvg[hh] > 0.0) ? gAvg[hh] : EMPTY_VALUE;
      BufCol[i] = (sp > 0.0) ? AT24SG_Status(sp, gAvg[hh], InpOKMult, InpSpikeMult) : 0;
     }

   //--- live status
   MqlDateTime g;
   TimeToStruct(ToGmt(TimeCurrent()), g);
   double now = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   double typ = gAvg[g.hour];
   int st = AT24SG_Status(now, typ, InpOKMult, InpSpikeMult);
   if(InpAlertSpike && st == 3 && gLastStatus != 3 && TimeCurrent() - gLastAlert > 300)
     {
      string msg = StringFormat("AT24 Spread Guard %s: spread %.0f pts is %.1fx typical for %02d:00 GMT", _Symbol, now, typ > 0 ? now / typ : 0.0, g.hour);
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
      gLastAlert = TimeCurrent();
     }
   gLastStatus = st;
   if(gDash) UpdateDash(st, now, typ, CurrentATR(rates_total, high, low, close), g.hour);
   return rates_total;
  }


