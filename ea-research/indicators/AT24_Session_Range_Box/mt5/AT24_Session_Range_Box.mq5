//+------------------------------------------------------------------+
//| AT24 Session Range Box (MT5)                                     |
//| The Asian range, drawn - and what it really did on YOUR symbol.  |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Session Range Box - Asia range boxes + how breakouts of that range really behaved."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_SessionBox_Core.mqh"
#include "AT24_ServerClock.mqh"

#resource "sb_logo56.bmp"

input group "=== Session (GMT) ==="
input int    InpAsiaStartHour = 0;      // Asia box starts (GMT hour)
input int    InpAsiaEndHour   = 7;      // Asia box ends = London open (GMT hour)
input int    InpDayEndHour    = 21;     // Stop watching for a break at (GMT hour)
input double InpBreakBufferPts= 0;      // Close must be beyond the box by this many points
input group "=== History ==="
input int    InpStatDays      = 60;     // Days used for the statistics
input int    InpBoxDays       = 10;     // Boxes drawn on the chart
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (recommended)
input bool   InpAutoOffset    = true;   // Fallback: detect the current server offset from GMT
input int    InpOffsetHours   = 0;      // Fallback: manual server offset in hours (if auto is off)
input group "=== Colours ==="
input color  InpBoxColor      = C'30,70,110'; // Asia box fill
input color  InpUpColor       = clrLimeGreen; // Break up
input color  InpDownColor     = clrTomato;    // Break down
input color  InpNoneColor     = clrGold;      // No break yet
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertBreak    = false;  // Alert when the Asia box is first broken
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];   // today's hi, lo, break dir, held, size vs median
string PFX = "AT24SB_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gAlertKey = 0;
AT24SB_Day gDays[];
int    gN = 0;
double gStats[];
datetime gAsiaOpen = 0;

#define DASH_W 340
#define DASH_H 258

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

datetime ToServer(const datetime gmt)
  {
   if(UseClock()) return gmt + (datetime)((long)AT24SC_OffsetHoursAtUtc(gClk, gmt) * 3600);
   return gmt + (datetime)ServerOffsetSec();
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sb_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

color StateColor(const AT24SB_Day &d)
  {
   if(d.boxStart == 0 || !d.complete) return clrSlateGray;
   if(d.brk == 1) return (d.finished && d.held == 0) ? clrOrange : InpUpColor;
   if(d.brk == 2) return (d.finished && d.held == 0) ? clrOrange : InpDownColor;
   return InpNoneColor;
  }

void DrawBoxes()
  {
   ObjectsDeleteAll(0, PFX + "box");
   int shown = 0;
   for(int i = gN - 1; i >= 0 && shown < InpBoxDays; i--)
     {
      if(gDays[i].boxStart == 0 || gDays[i].hi <= gDays[i].lo) continue;
      shown++;
      string k = IntegerToString(gDays[i].key);
      string a = PFX + "box_a" + k, e = PFX + "box_e" + k, t = PFX + "box_t" + k;
      ObjectCreate(0, a, OBJ_RECTANGLE, 0, gDays[i].boxStart, gDays[i].hi, gDays[i].boxEnd, gDays[i].lo);
      ObjectSetInteger(0, a, OBJPROP_COLOR, InpBoxColor);
      ObjectSetInteger(0, a, OBJPROP_FILL, true);
      ObjectSetInteger(0, a, OBJPROP_BACK, true);
      ObjectSetInteger(0, a, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, a, OBJPROP_HIDDEN, true);
      color sc = StateColor(gDays[i]);
      ObjectCreate(0, e, OBJ_RECTANGLE, 0, gDays[i].boxEnd, gDays[i].hi, gDays[i].dayEnd, gDays[i].lo);
      ObjectSetInteger(0, e, OBJPROP_COLOR, sc);
      ObjectSetInteger(0, e, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, e, OBJPROP_FILL, false);
      ObjectSetInteger(0, e, OBJPROP_BACK, true);
      ObjectSetInteger(0, e, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, e, OBJPROP_HIDDEN, true);
      ObjectCreate(0, t, OBJ_TEXT, 0, gDays[i].boxEnd, gDays[i].hi);
      ObjectSetString(0, t, OBJPROP_TEXT, "Asia " + DoubleToString(gDays[i].hi - gDays[i].lo, _Digits));
      ObjectSetInteger(0, t, OBJPROP_COLOR, sc);
      ObjectSetInteger(0, t, OBJPROP_FONTSIZE, 8);
      ObjectSetInteger(0, t, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, t, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, t, OBJPROP_HIDDEN, true);
     }
  }

string Countdown(const int unused)
  {
   MqlDateTime g; TimeToStruct(ToGmt(TimeCurrent()), g);
   int nowMin = g.hour * 60 + g.min;
   int open = InpAsiaEndHour * 60;
   int diff = open - nowMin;
   if(diff < 0) diff += 1440;
   if(nowMin >= open && nowMin < InpDayEndHour * 60) return StringFormat("London open was %dh %02dm ago", (nowMin - open) / 60, (nowMin - open) % 60);
   return StringFormat("London open in %dh %02dm", diff / 60, diff % 60);
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   int ti = gN - 1;
   int todayKey = AT24SB_GmtKey(ToGmt(TimeCurrent()), 0);
   bool haveToday = (ti >= 0 && gDays[ti].key == todayKey);
   MakeLabel("t1", 70, 6, "AT24 SESSION RANGE BOX", C'230,190,80', 10, true);
   if(!haveToday)
     {
      MakeLabel("t2", 70, 26, "WAITING FOR TODAY'S BARS", clrSlateGray, 10, true);
      return;
     }
   AT24SB_Day t = gDays[ti];
   MakeLabel("t2", 70, 26, AT24SB_StateName(t), StateColor(t), 11, true);
   if(t.boxStart != 0)
     {
      double size = t.hi - t.lo;
      MakeLabel("l1", 10, 66, StringFormat("Asia box  %s - %s   size %s", DoubleToString(t.lo, _Digits), DoubleToString(t.hi, _Digits), DoubleToString(size, _Digits)), clrWhite, 9);
      string rel = (gStats[6] > 0.0) ? StringFormat("%.2fx the median box (%s)", size / gStats[6], DoubleToString(gStats[6], _Digits)) : "median not ready";
      MakeLabel("l2", 10, 82, "Size  " + rel, clrWhite, 9);
     }
   else { MakeLabel("l1", 10, 66, "No bars inside the Asia window yet (check hours / offset).", clrOrange, 9); MakeLabel("l2", 10, 82, "", clrWhite, 9); }
   MakeLabel("l3", 10, 98, Countdown(0), clrGold, 9);
   MakeLabel("h1", 10, 122, StringFormat("Last %d days on this symbol  (%d with a box)", InpStatDays, (int)gStats[0]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 140, StringFormat("First break: up %.0f%%   down %.0f%%   none %.0f%%", gStats[1], gStats[2], gStats[3]), clrWhite, 9);
   MakeLabel("s2", 10, 156, StringFormat("When it broke: held to day end %.0f%%", gStats[4]), clrWhite, 9);
   MakeLabel("s3", 10, 172, StringFormat("When it broke: ran 1x the box or more %.0f%%", gStats[5]), clrWhite, 9);
   MakeLabel("n1", 10, 194, StringFormat("GMT %02d-%02d box to %02d, break = close beyond. Clock: %s", InpAsiaStartHour, InpAsiaEndHour, InpDayEndHour, ClockName()), clrSlateGray, 8);
   MakeLabel("f1", 10, 220, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 232, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS); SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Session Range Box");
   if(InpAsiaStartHour < 0 || InpAsiaEndHour <= InpAsiaStartHour || InpDayEndHour <= InpAsiaEndHour || InpDayEndHour > 24 || InpStatDays < 5)
     {
      Print("AT24 Session Range Box: need 0 <= Asia start < Asia end < day end <= 24 and at least 5 stat days.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(PeriodSeconds(_Period) > 3600) { Print("AT24 Session Range Box: use a chart timeframe of H1 or lower."); return INIT_PARAMETERS_INCORRECT; }
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

void OnDeinit(const int reason)
  {
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
      //--- closed bars only (the forming bar can still change): no repaint.
      //--- the core works on GMT times (offset 0); the window below converts every bar with the DST-aware clock
      int total = rates_total - 1;
      int nbw = (int)MathMin((double)total, (double)((InpStatDays + 3) * 86400 / MathMax(1, PeriodSeconds(_Period)) + 200));
      int basew = total - nbw;
      datetime tg[]; double wh[], wl[], wc[];
      ArrayResize(tg, nbw); ArrayResize(wh, nbw); ArrayResize(wl, nbw); ArrayResize(wc, nbw);
      for(int q = 0; q < nbw; q++) { tg[q] = ToGmt(time[basew + q]); wh[q] = high[basew + q]; wl[q] = low[basew + q]; wc[q] = close[basew + q]; }
      gN = AT24SB_Analyze(nbw, tg, wh, wl, wc, 0, InpAsiaStartHour * 60, InpAsiaEndHour * 60, InpDayEndHour * 60,
                          InpBreakBufferPts * _Point, InpStatDays, gDays);
      //--- the core returned GMT-based times: convert them back to server time for drawing
      for(int j = 0; j < gN; j++)
        {
         if(gDays[j].boxStart != 0) gDays[j].boxStart = ToServer(gDays[j].boxStart);
         if(gDays[j].boxEnd != 0)   gDays[j].boxEnd = ToServer(gDays[j].boxEnd);
         if(gDays[j].dayEnd != 0)   gDays[j].dayEnd = ToServer(gDays[j].dayEnd);
         if(gDays[j].brkTime != 0)  gDays[j].brkTime = ToServer(gDays[j].brkTime);
        }
      AT24SB_Stats(gDays, gN, gStats);
      DrawBoxes();
      //--- alert once per day when the box is first broken
      int ti = gN - 1;
      if(InpAlertBreak && ti >= 0 && gDays[ti].key == AT24SB_GmtKey(ToGmt(TimeCurrent()), 0) && gDays[ti].brk != 0 && gAlertKey != gDays[ti].key)
        {
         gAlertKey = gDays[ti].key;
         string msg = StringFormat("AT24 Session Range Box %s: Asia box %s - %s broken %s", _Symbol, DoubleToString(gDays[ti].lo, _Digits), DoubleToString(gDays[ti].hi, _Digits), gDays[ti].brk == 1 ? "UP" : "DOWN");
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
     }
   int ti2 = gN - 1;
   if(ti2 >= 0)
     {
      B0[0] = gDays[ti2].hi; B1[0] = gDays[ti2].lo; B2[0] = gDays[ti2].brk; B3[0] = gDays[ti2].held;
      B4[0] = (gStats[6] > 0.0 && gDays[ti2].boxStart != 0) ? (gDays[ti2].hi - gDays[ti2].lo) / gStats[6] : 0.0;
     }
   UpdateDash();
   return rates_total;
  }
