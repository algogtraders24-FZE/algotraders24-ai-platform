//+------------------------------------------------------------------+
//| AT24 NY Opening Range (MT5)                                      |
//| The first 30 minutes of the New York cash session (09:30 New     |
//| York time, daylight-saving aware) and what price really did      |
//| afterwards on YOUR symbol - against a control window.            |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 NY Opening Range - OR box, breakout state, time left + real statistics vs a control window."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_ServerClock.mqh"
#include "AT24_NYOR_Core.mqh"

#resource "ny_logo56.bmp"

input group "=== Opening range (New York time) ==="
input int    InpStartHour     = 9;      // Range start hour (New York)
input int    InpStartMin      = 30;     // Range start minute
input int    InpLenMin        = 30;     // Range length (minutes)
input int    InpEndHour       = 16;     // Window end hour (New York)
input int    InpBufferPts     = 0;      // Break buffer (points beyond the box)
input int    InpFakeBars      = 4;      // Bars to judge a false break
input int    InpControlHour   = 11;     // Control window start hour (same length) for the comparison
input group "=== Clock ==="
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (recommended)
input group "=== Look ==="
input int    InpHistoryBars   = 8000;   // Bars analysed
input int    InpDaysShown     = 5;      // Days drawn
input color  InpOpenColor     = clrGold;       // Range not broken yet
input color  InpUpColor       = clrLimeGreen;  // Broke up
input color  InpDownColor     = clrTomato;     // Broke down
input color  InpNoneColor     = clrSlateGray;  // No break
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertBreak    = false;  // Alert when today's range breaks
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24NY_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gNb = 0;
AT24OR_Day gD[], gDc[];
int    gN = 0, gNc = 0;
double gStats[], gCtrl[];
int    gLastMin = 0;        // New York minute of the day of the last closed bar
long   gLastKey = 0;
long   gAlertKey = 0;
bool   gUsedClock = false;

#define DASH_W 360
#define DASH_H 262

//--- DST-aware broker clock (AT24_ServerClock.mqh). Falls back to the constant offset when detection fails.
AT24SC_Clock gClk;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

void RefreshClock()
  {
   if(!InpDstAware) { gClk.ok = false; return; }
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_Detect(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
  }

bool UseClock() { return (InpDstAware && gClk.ok); }

datetime ToGmt(const datetime serverTime)
  {
   if(UseClock()) return AT24SC_ToGmt(gClk, serverTime);
   int off = (int)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;
   return serverTime - (datetime)off;
  }

datetime ToNy(const datetime serverTime)
  {
   datetime g = ToGmt(serverTime);
   return g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600);
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ny_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

color DayColor(const AT24OR_Day &d) { return d.brk == 1 ? InpUpColor : (d.brk == -1 ? InpDownColor : (d.complete ? InpNoneColor : InpOpenColor)); }

void DrawDays(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "bx");
   int shown = 0;
   for(int i = gN - 1; i >= 0 && shown < InpDaysShown; i--)
     {
      if(gD[i].first < 0) continue;
      shown++;
      color col = DayColor(gD[i]);
      datetime t1 = time[base + gD[i].first];
      datetime t2 = time[base + gD[i].orEnd] + PeriodSeconds();
      datetime t3 = (gD[i].lastBar >= 0) ? time[base + gD[i].lastBar] : time[rates_total - 1] + PeriodSeconds() * 8;
      string nm = PFX + "bx" + IntegerToString(gD[i].first);
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, gD[i].hi, t2, gD[i].lo);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
      ObjectSetInteger(0, nm, OBJPROP_FILL, true);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      for(int s = 0; s < 2; s++)
        {
         string ln = nm + (s == 0 ? "h" : "l");
         double p = (s == 0) ? gD[i].hi : gD[i].lo;
         ObjectCreate(0, ln, OBJ_TREND, 0, t2, p, t3, p);
         ObjectSetInteger(0, ln, OBJPROP_COLOR, col);
         ObjectSetInteger(0, ln, OBJPROP_WIDTH, 2);
         ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT, false);
         ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, ln, OBJPROP_HIDDEN, true);
        }
      string tx = nm + "t";
      ObjectCreate(0, tx, OBJ_TEXT, 0, t1, gD[i].hi);
      ObjectSetString(0, tx, OBJPROP_TEXT, gD[i].brk == 1 ? "NY OR up" : (gD[i].brk == -1 ? "NY OR down" : "NY OR"));
      ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
  }

string Hm(const int minutes) { return StringFormat("%02d:%02d", (minutes / 60) % 24, minutes % 60); }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   int start = InpStartHour * 60 + InpStartMin, endOr = start + InpLenMin, endWin = InpEndHour * 60;
   MakeLabel("t1", 70, 6, "AT24 NY OPENING RANGE", C'230,190,80', 10, true);
   string state; color sc = clrSlateGray;
   bool haveToday = (gN > 0 && gD[gN - 1].key == gLastKey && gD[gN - 1].first >= 0);
   AT24OR_Day t;
   ZeroMemory(t);
   if(haveToday) t = gD[gN - 1];
   if(gLastMin < start && !haveToday) { state = StringFormat("OPENS IN %d MIN", start - gLastMin); sc = clrSlateGray; }
   else if(gLastMin >= start && gLastMin < endOr) { state = "RANGE FORMING"; sc = clrGold; }
   else if(haveToday && gLastMin <= endWin)
     {
      if(t.brk == 1) { state = "BROKE UP"; sc = InpUpColor; }
      else if(t.brk == -1) { state = "BROKE DOWN"; sc = InpDownColor; }
      else { state = "RANGE SET - NO BREAK YET"; sc = InpOpenColor; }
     }
   else if(haveToday) { state = t.brk == 1 ? "DONE: BROKE UP" : (t.brk == -1 ? "DONE: BROKE DOWN" : "DONE: NO BREAK"); sc = clrSlateGray; }
   else { state = "NO RANGE TODAY"; sc = clrSlateGray; }
   MakeLabel("t2", 70, 26, state, sc, 11, true);
   if(haveToday)
      MakeLabel("l1", 10, 66, StringFormat("Box %s - %s  (%s tall)   NY %s", DoubleToString(t.lo, Dg()), DoubleToString(t.hi, Dg()), DoubleToString(t.hi - t.lo, Dg()), Hm(gLastMin)), clrWhite, 9);
   else
      MakeLabel("l1", 10, 66, StringFormat("Range %s - %s New York.   NY now %s", Hm(start), Hm(endOr), Hm(gLastMin)), clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("Clock: %s   (window ends %s NY)", UseClock() ? (gClk.rule == AT24SC_US ? "US DST detected" : (gClk.rule == AT24SC_EU ? "EU DST detected" : "fixed offset")) : "fixed offset", Hm(endWin)), clrSlateGray, 8);
   MakeLabel("h1", 10, 104, StringFormat("Last %d days (%s range): up %.0f%%  down %.0f%%  none %.0f%%", (int)gStats[0], Hm(start), gStats[1], gStats[2], gStats[3]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 122, StringFormat("Break held to %s: %.0f%%   ran 1 box height: %.0f%%", Hm(endWin), gStats[4], gStats[6]), clrWhite, 9);
   MakeLabel("s2", 10, 138, StringFormat("Fell back inside within %d bars: %.0f%%  (%d broken days)", InpFakeBars, gStats[5], (int)gStats[8]), clrWhite, 9);
   MakeLabel("c1", 10, 160, StringFormat("Control window %s-%s: held %.0f%%  fell back %.0f%%  ran %.0f%%", Hm(InpControlHour * 60), Hm(InpControlHour * 60 + InpLenMin), gCtrl[4], gCtrl[5], gCtrl[6]), clrWhite, 9);
   MakeLabel("n1", 10, 184, "A real edge would beat the control window clearly.", clrSlateGray, 8);
   MakeLabel("n2", 10, 198, "Held ~50% and fell-back ~45% = coin flip.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 NY Opening Range");
   if(InpStartHour < 0 || InpStartHour > 23 || InpStartMin < 0 || InpStartMin > 59 || InpLenMin < 5 || InpLenMin > 180 ||
      InpEndHour <= InpStartHour || InpEndHour > 23 || InpControlHour < 0 || InpControlHour > 22 || InpFakeBars < 1)
     {
      Print("AT24 NY Opening Range: check hours (end after start), length 5-180 min, control hour 0-22.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(PeriodSeconds() > 1800)
     {
      Print("AT24 NY Opening Range: use a chart of M30 or lower.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gStats, 9); ArrayResize(gCtrl, 9);
   for(int z = 0; z < 9; z++) { gStats[z] = 0.0; gCtrl[z] = 0.0; }
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
   RefreshClock();
   if(prev_calculated == 0 || rates_total != gLastTotal || UseClock() != gUsedClock)
     {
      gLastTotal = rates_total;
      gUsedClock = UseClock();
      //--- closed bars only: ranges, breaks and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      gNb = nb;
      datetime lt[]; double h[], l[], c[];
      ArrayResize(lt, nb); ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { lt[q] = ToNy(time[base + q]); h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      int start = InpStartHour * 60 + InpStartMin;
      gN = AT24OR_Analyze(nb, lt, h, l, c, start, InpLenMin, InpEndHour * 60, InpBufferPts * _Point, InpFakeBars, gD);
      gNc = AT24OR_Analyze(nb, lt, h, l, c, InpControlHour * 60, InpLenMin, InpEndHour * 60, InpBufferPts * _Point, InpFakeBars, gDc);
      AT24OR_Stats(gD, gN, gStats);
      AT24OR_Stats(gDc, gNc, gCtrl);
      gLastKey = (long)lt[nb - 1] / 86400;
      gLastMin = (int)(((long)lt[nb - 1] % 86400) / 60);
      DrawDays(base, time, rates_total);
      if(InpAlertBreak && gN > 0 && gD[gN - 1].key == gLastKey && gD[gN - 1].brk != 0 && gD[gN - 1].brkBar == nb - 1 && gAlertKey != gLastKey)
        {
         gAlertKey = gLastKey;
         string msg = StringFormat("AT24 NY Opening Range %s: range %s - %s broken %s", _Symbol, DoubleToString(gD[gN - 1].lo, Dg()), DoubleToString(gD[gN - 1].hi, Dg()), gD[gN - 1].brk == 1 ? "UP" : "DOWN");
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      if(gN > 0)
        {
         B0[0] = gD[gN - 1].hi; B1[0] = gD[gN - 1].lo; B2[0] = gD[gN - 1].brk; B3[0] = gD[gN - 1].held; B4[0] = gLastMin;
        }
     }
   UpdateDash();
   return rates_total;
  }
