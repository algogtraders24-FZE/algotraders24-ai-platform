//+------------------------------------------------------------------+
//| AT24 Event Move Map (MT5)                                        |
//| What do economic releases usually do to THIS symbol? For every   |
//| high-importance release type: how far the symbol moved in the    |
//| hour after past releases (from the terminal's own calendar       |
//| history), compared with a normal hour, and the same numbers      |
//| next to the releases coming up in the next days.                 |
//| Descriptive. Not a signal.                                       |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Event Move Map - the typical move of the chart symbol after each type of high-importance release, from the built-in economic calendar history, shown next to the upcoming releases."
#property description "It places no trades and gives no signals. Needs the terminal's economic calendar."
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   0

#include "AT24_ServerClock.mqh"
#include "AT24_Pullback_Core.mqh"
#include "AT24_EM_Core.mqh"

#resource "em_logo56.bmp"

input group "=== Releases ==="
input string InpCurrencies    = "USD";  // Calendar currencies, comma separated (e.g. USD,EUR)
input int    InpWindowMin     = 60;     // Minutes after the release that are measured (15, 30, 60, 90, 120)
input int    InpDaysAhead     = 7;      // Days of upcoming releases shown
input bool   InpCalUtc        = false;  // Calendar times are UTC (offline terminal); leave off on a connected broker terminal (calendar uses server time)
input group "=== Alerts ==="
input int    InpAlertMinutes  = 0;      // Alert this many minutes before an upcoming release (0 = off)
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Clock ==="
input int    InpManualBase    = -99;    // Broker clock: winter offset from GMT in hours (-99 = detect automatically; only used when the calendar is UTC)
input ENUM_AT24SC_RULE InpManualRule = AT24SC_US; // Broker clock: daylight rule when set manually (1 none, 2 US, 3 EU)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[];
string PFX = "AT24EM_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gW = 700, gH = 372;
AT24EM_Stat gSt[];
int    gNg = 0, gBars = 0, gMeasured = 0;
double gBase = 0.0;
datetime gBuiltBar = 0, gUpAt = 0;
AT24SC_Clock gClk; datetime gClkAt = 0; int gMeas[]; datetime gUtc[];
string gUpName[]; datetime gUpTime[]; int gUpN = 0;
datetime gAlerted[];
string gCur[]; int gNcur = 0;

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - gW - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - gH - InpDashY) : InpDashY;
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
   ObjectSetInteger(0, n, OBJPROP_XSIZE, gW);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, gH);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::em_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int FindStat(const string name) { for(int k = 0; k < gNg; k++) if(gSt[k].name == name) return k; return -1; }

string InTxt(const long secs)
  {
   if(secs < 0) return "now";
   if(secs < 3600) return StringFormat("%d min", (int)(secs / 60));
   if(secs < 86400) return StringFormat("%dh %dm", (int)(secs / 3600), (int)((secs % 3600) / 60));
   return StringFormat("%dd %dh", (int)(secs / 86400), (int)((secs % 86400) / 3600));
  }

string Short(const string s, const int n) { return StringLen(s) <= n ? s : StringSubstr(s, 0, n - 1) + "."; }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 EVENT MOVE MAP", C'230,190,80', 10, true);
   if(gBars < 1000 || gNg == 0)
     {
      MakeLabel("t2", 70, 26, gBars < 1000 ? "LOADING M15 HISTORY" : "NO CALENDAR HISTORY FOUND", clrSlateGray, 11, true);
      MakeLabel("t3", 70, 42, "The economic calendar is only available on a live terminal.", clrSilver, 8);
      return;
     }
   datetime now = TimeCurrent();
   int nextI = -1; for(int i = 0; i < gUpN; i++) if(gUpTime[i] >= now) { nextI = i; break; }
   if(nextI >= 0)
     {
      int k = FindStat(gUpName[nextI]);
      MakeLabel("t2", 70, 26, StringFormat("Next: %s in %s", Short(gUpName[nextI], 34), InTxt((long)(gUpTime[nextI] - now))), clrGold, 10, true);
      MakeLabel("t3", 70, 42, k >= 0 ? StringFormat("usual %d-min range on %s: %.0f bp, %.1fx normal, n=%d", InpWindowMin, _Symbol, gSt[k].meanRange, gSt[k].meanRangeX, gSt[k].n) : "no history for this release type on this symbol", clrWhite, 8, true);
     }
   else
     {
      MakeLabel("t2", 70, 26, "No high-importance release in the calendar ahead", clrSlateGray, 10, true);
      MakeLabel("t3", 70, 42, StringFormat("%s, %d-minute window after each release", _Symbol, InpWindowMin), clrSilver, 8);
     }
   MakeLabel("u0", 10, 66, "Coming up", C'230,190,80', 8, true);
   int shown = 0;
   for(int i = 0; i < gUpN && shown < 6; i++)
     {
      if(gUpTime[i] < now) continue;
      int k = FindStat(gUpName[i]); string id = IntegerToString(shown); int y = 82 + shown * 14;
      MakeLabel("ua" + id, 10, y, TimeToString(gUpTime[i], TIME_DATE | TIME_MINUTES), clrSilver, 8);
      MakeLabel("ub" + id, 120, y, Short(gUpName[i], 36), clrWhite, 8, true);
      MakeLabel("uc" + id, 360, y, InTxt((long)(gUpTime[i] - now)), clrSilver, 8);
      MakeLabel("ud" + id, 440, y, k >= 0 ? StringFormat("%.0f bp  %.1fx  n=%d", gSt[k].meanRange, gSt[k].meanRangeX, gSt[k].n) : "no history", k >= 0 && gSt[k].meanRangeX >= 2.0 ? clrGold : clrSilver, 8);
      shown++;
     }
   for(int s = shown; s < 6; s++) { string id = IntegerToString(s); MakeLabel("ua" + id, 10, 82 + s * 14, " ", clrWhite, 8); MakeLabel("ub" + id, 120, 82 + s * 14, " ", clrWhite, 8); MakeLabel("uc" + id, 360, 82 + s * 14, " ", clrWhite, 8); MakeLabel("ud" + id, 440, 82 + s * 14, " ", clrWhite, 8); }
   MakeLabel("p0", 10, 176, StringFormat("Biggest past reactions (%d-minute window, %d measured releases)", InpWindowMin, gMeasured), C'230,190,80', 8, true);
   MakeLabel("ph1", 10, 192, "Release", clrSlateGray, 8, true); MakeLabel("ph2", 300, 192, "n", clrSlateGray, 8, true); MakeLabel("ph3", 340, 192, "avg move", clrSlateGray, 8, true); MakeLabel("ph4", 430, 192, "avg range", clrSlateGray, 8, true); MakeLabel("ph5", 530, 192, "vs normal", clrSlateGray, 8, true);
   //--- top 8 by mean range
   int ord[]; ArrayResize(ord, gNg); for(int i = 0; i < gNg; i++) ord[i] = i;
   for(int i = 1; i < gNg; i++) { int a = ord[i]; int j = i - 1; while(j >= 0 && gSt[ord[j]].meanRange < gSt[a].meanRange) { ord[j + 1] = ord[j]; j--; } ord[j + 1] = a; }
   int rows = 0;
   for(int q = 0; q < gNg && rows < 8; q++)
     {
      AT24EM_Stat s = gSt[ord[q]]; if(s.n < 3) continue;
      string id = IntegerToString(rows); int y = 208 + rows * 14;
      MakeLabel("pa" + id, 10, y, Short(s.name, 40), clrWhite, 8, true);
      MakeLabel("pb" + id, 300, y, IntegerToString(s.n), s.n < 8 ? clrSlateGray : clrSilver, 8);
      MakeLabel("pc" + id, 340, y, StringFormat("%.0f bp", s.meanAbsMove), clrSilver, 8);
      MakeLabel("pd" + id, 430, y, StringFormat("%.0f bp", s.meanRange), clrSilver, 8);
      MakeLabel("pe" + id, 530, y, StringFormat("%.1fx", s.meanRangeX), s.meanRangeX >= 2.0 ? clrGold : clrSilver, 8, s.meanRangeX >= 2.0);
      rows++;
     }
   for(int s = rows; s < 8; s++) { string id = IntegerToString(s); int y = 208 + s * 14; MakeLabel("pa" + id, 10, y, " ", clrWhite, 8); MakeLabel("pb" + id, 300, y, " ", clrWhite, 8); MakeLabel("pc" + id, 340, y, " ", clrWhite, 8); MakeLabel("pd" + id, 430, y, " ", clrWhite, 8); MakeLabel("pe" + id, 530, y, " ", clrWhite, 8); }
   MakeLabel("n1", 10, 326, "Size only, not direction. n below 8 = thin sample (grey).", clrSlateGray, 8);
   MakeLabel("f1", 10, 348, "Descriptive, not a signal or advice. algotraders24.ai", clrSlateGray, 7);
  }

void RefreshClock()
  {
   if(!InpCalUtc) return;
   if(InpManualBase != -99) { if(!gClk.ok || gClkAt == 0) { AT24SC_SetManual(gClk, InpManualBase, (int)InpManualRule); gClkAt = TimeCurrent(); } return; }
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_DetectAny(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
  }

bool CurrencyOk(const string cur) { for(int k = 0; k < gNcur; k++) if(gCur[k] == cur) return true; return false; }

datetime ToBarClock(const datetime t) { return InpCalUtc ? t + (datetime)((long)AT24SC_OffsetHoursAtUtc(gClk, t) * 3600) : t; }

bool RebuildHistory()
  {
   if(InpCalUtc && !gClk.ok) return false;
   MqlRates rr[];
   int n = CopyRates(_Symbol, PERIOD_M15, 1, 40000, rr);
   if(n < 1000) { gBars = MathMax(n, 0); return false; }
   datetime t[]; double o[], h[], l[], c[], at[]; ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(at, n);
   for(int i = 0; i < n; i++) { t[i] = rr[i].time; o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; c[i] = rr[i].close; }
   AT24TP_Atr(n, h, l, c, 14, at);
   int wb = MathMax(1, InpWindowMin / 15);
   string names[]; AT24EM_Occ occ[]; int m = 0;
   for(int ci = 0; ci < gNcur; ci++)
     {
      MqlCalendarValue v[];
      datetime from = InpCalUtc ? t[0] - (datetime)(14 * 3600) - 86400 : t[0] - 86400;
      int cn = CalendarValueHistory(v, from, TimeCurrent(), NULL, gCur[ci]);
      if(cn <= 0) continue;
      int old = ArraySize(names); ArrayResize(names, old + cn); ArrayResize(occ, old + cn);
      for(int i = 0; i < cn; i++)
        {
         MqlCalendarEvent e;
         if(!CalendarEventById(v[i].event_id, e) || (int)e.importance != CALENDAR_IMPORTANCE_HIGH) continue;
         datetime ts = ToBarClock(v[i].time);
         if(ts >= t[n - 1]) continue;
         names[m] = e.name;
         AT24EM_Measure(n, t, o, h, l, c, at, ts, 900, wb, occ[m]);
         m++;
        }
     }
   ArrayResize(names, MathMax(m, 1)); ArrayResize(occ, MathMax(m, 1));
   gBase = AT24EM_Baseline(n, h, l, at, wb);
   gNg = AT24EM_Group(names, occ, m, gBase, gSt);
   gMeasured = 0; for(int i = 0; i < m; i++) if(occ[i].ok) gMeasured++;
   gBars = n;
   B0[0] = gMeasured; B1[0] = gNg;
   return true;
  }

void RefreshUpcoming()
  {
   if(InpCalUtc && !gClk.ok) return;
   datetime now = TimeCurrent();
   gUpN = 0; ArrayResize(gUpName, 0); ArrayResize(gUpTime, 0);
   for(int ci = 0; ci < gNcur; ci++)
     {
      MqlCalendarValue v[];
      datetime from = InpCalUtc ? now - (datetime)(14 * 3600) : now - 3600;
      datetime to = InpCalUtc ? now + (datetime)((long)InpDaysAhead * 86400 + 14 * 3600) : now + (datetime)((long)InpDaysAhead * 86400);
      int cn = CalendarValueHistory(v, from, to, NULL, gCur[ci]);
      for(int i = 0; i < cn; i++)
        {
         MqlCalendarEvent e;
         if(!CalendarEventById(v[i].event_id, e) || (int)e.importance != CALENDAR_IMPORTANCE_HIGH) continue;
         datetime ts = ToBarClock(v[i].time);
         if(ts < now - 600 || ts > now + (datetime)((long)InpDaysAhead * 86400)) continue;
         int p = gUpN; ArrayResize(gUpName, p + 1); ArrayResize(gUpTime, p + 1);
         //--- insertion sort by time
         while(p > 0 && gUpTime[p - 1] > ts) { gUpName[p] = gUpName[p - 1]; gUpTime[p] = gUpTime[p - 1]; p--; }
         gUpName[p] = e.name; gUpTime[p] = ts; gUpN++;
        }
     }
   gUpAt = now;
   if(InpAlertMinutes > 0)
      for(int i = 0; i < gUpN; i++)
        {
         long left = (long)(gUpTime[i] - now);
         if(left < 0 || left > (long)InpAlertMinutes * 60) continue;
         bool done = false; int ac = ArraySize(gAlerted); for(int a = 0; a < ac; a++) if(gAlerted[a] == gUpTime[i]) { done = true; break; }
         if(done) continue;
         ArrayResize(gAlerted, ac + 1); gAlerted[ac] = gUpTime[i];
         int k = FindStat(gUpName[i]);
         string msg = StringFormat("AT24 Event Move Map: %s in %s. Usual %d-min range on %s: %s", gUpName[i], InTxt(left), InpWindowMin, _Symbol, k >= 0 ? StringFormat("%.0f bp (%.1fx normal, n=%d)", gSt[k].meanRange, gSt[k].meanRangeX, gSt[k].n) : "no history");
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
  }

void Refresh()
  {
   RefreshClock();
   datetime bar = iTime(_Symbol, PERIOD_M15, 0);
   if(bar != 0 && gBuiltBar != bar) { if(RebuildHistory()) gBuiltBar = bar; }
   if(gUpAt == 0 || TimeCurrent() - gUpAt >= 60) RefreshUpcoming();
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Event Move Map");
   if((InpWindowMin != 15 && InpWindowMin != 30 && InpWindowMin != 60 && InpWindowMin != 90 && InpWindowMin != 120) || InpDaysAhead < 1 || InpDaysAhead > 30 || InpAlertMinutes < 0 || InpAlertMinutes > 720)
     {
      Print("AT24 Event Move Map: window 15/30/60/90/120 minutes, days ahead 1-30, alert 0-720 minutes.");
      return INIT_PARAMETERS_INCORRECT;
     }
   string parts[]; int np = StringSplit(InpCurrencies, ',', parts);
   ArrayResize(gCur, 0); gNcur = 0;
   for(int i = 0; i < np && gNcur < 6; i++) { string s = parts[i]; StringTrimLeft(s); StringTrimRight(s); StringToUpper(s); if(StringLen(s) < 2) continue; ArrayResize(gCur, gNcur + 1); gCur[gNcur++] = s; }
   if(gNcur == 0) { Print("AT24 Event Move Map: no currency given."); return INIT_PARAMETERS_INCORRECT; }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
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
   if(rates_total < 2) return 0;
   return rates_total;
  }
