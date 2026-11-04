//+------------------------------------------------------------------+
//| AT24 News Risk Clock (MT5)                                       |
//| Countdown to the next high-impact news (MetaTrader economic      |
//| calendar), a risk-window state, and how much bigger price ranges |
//| really were after such news on YOUR symbol.                      |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 News Risk Clock - next high-impact events, risk-window state, real range-after-news statistics."
#property description "Uses the terminal's built-in economic calendar. Descriptive history. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_ServerClock.mqh"
#include "AT24_NW_Core.mqh"

#resource "nw_logo56.bmp"

enum ENUM_AT24NW_IMP
  {
   NW_HIGH     = 3,   // High impact only
   NW_MODERATE = 2    // Moderate and high
  };

enum ENUM_AT24NW_CLK
  {
   NW_CLK_SERVER   = 0,  // Same clock as the chart bars (normal: terminal connected to your broker)
   NW_CLK_TERMINAL = 1   // The terminal's own trade-server clock (not connected / differs from the bars) - convert with the detected broker clock
  };

input ENUM_AT24NW_CLK InpCalClock = NW_CLK_SERVER;   // Clock of the calendar times
input group "=== News filter ==="
input string InpCurrencies    = "USD";          // Currencies (comma separated, e.g. USD,EUR)
input ENUM_AT24NW_IMP InpImportance = NW_HIGH;  // Importance shown
input int    InpSoonMin       = 60;     // "Event soon" window (minutes before)
input int    InpNowMin        = 15;     // "Risk window" (minutes before)
input int    InpAfterMin      = 30;     // "Just released" window (minutes after)
input int    InpStudyMin      = 30;     // Minutes after an event used for the statistics
input int    InpStudyDays     = 85;     // Days of history used for the statistics
input group "=== Look ==="
input int    InpLinesAhead    = 2;      // Days ahead to draw event lines
input color  InpEventColor    = clrGold;        // Event lines
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts ==="
input bool   InpAlertSoon     = false;  // Alert when an event enters the risk window
input bool   InpAlertPush     = false;  // Also send push notification

struct NwEvent { datetime time; string name; string ccy; int imp; };

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24NW_";
bool   gDash = false, gTester = false;
int    gBaseX = 0, gBaseY = 0;
NwEvent gUp[];           // upcoming + recent events, sorted
int    gUpN = 0;
double gStudy[];
datetime gLoadAt = 0, gStudyAt = 0, gAlerted = 0;
int    gLoadTries = 0;
bool   gCalOk = false;

#define DASH_W 360
#define DASH_H 262

//--- calendar clock -> broker bar clock (drawing, statistics, display)
AT24SC_Clock gClk;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

void RefreshClock()
  {
   if(InpCalClock != NW_CLK_TERMINAL) return;
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_Detect(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
  }

datetime BarClock(const datetime t)
  {
   if(InpCalClock != NW_CLK_TERMINAL || !gClk.ok) return t;
   long tsOff = (long)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;   // terminal clock - UTC
   datetime utc = t - (datetime)tsOff;
   return utc + (datetime)((long)AT24SC_OffsetHoursAtUtc(gClk, utc) * 3600);
  }

datetime NowCal() { return TimeTradeServer(); }

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::nw_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

//--- load events between from and to for every currency in the input; keep importance >= InpImportance
int LoadEvents(const datetime from, const datetime to, NwEvent &out[])
  {
   ArrayResize(out, 0);
   int cnt = 0;
   string ccy[];
   int nc = StringSplit(InpCurrencies, ',', ccy);
   for(int c = 0; c < nc; c++)
     {
      string cc = ccy[c]; StringTrimLeft(cc); StringTrimRight(cc); StringToUpper(cc);
      if(StringLen(cc) != 3) continue;
      MqlCalendarValue v[];
      int n = CalendarValueHistory(v, from, to, NULL, cc);
      for(int i = 0; i < n; i++)
        {
         MqlCalendarEvent e;
         if(!CalendarEventById(v[i].event_id, e) || (int)e.importance < (int)InpImportance) continue;
         ArrayResize(out, cnt + 1);
         out[cnt].time = v[i].time; out[cnt].name = e.name; out[cnt].ccy = cc; out[cnt].imp = (int)e.importance;
         cnt++;
        }
     }
   //--- sort by time (insertion sort: small arrays)
   for(int i = 1; i < cnt; i++)
     {
      NwEvent k = out[i]; int j = i - 1;
      while(j >= 0 && out[j].time > k.time) { out[j + 1] = out[j]; j--; }
      out[j + 1] = k;
     }
   return cnt;
  }

string Span(const long sec)
  {
   long s = MathAbs(sec);
   long d = s / 86400, h = (s % 86400) / 3600, m = (s % 3600) / 60;
   if(d > 0) return StringFormat("%dd %dh", (int)d, (int)h);
   if(h > 0) return StringFormat("%dh %02dm", (int)h, (int)m);
   return StringFormat("%d min", (int)m);
  }

string Hm(const datetime t) { return TimeToString(BarClock(t), TIME_MINUTES); }

void DrawLines()
  {
   ObjectsDeleteAll(0, PFX + "ev");
   datetime now = NowCal();
   int shown = 0;
   for(int i = 0; i < gUpN && shown < 14; i++)
     {
      if(gUp[i].time < now - 86400 || gUp[i].time > now + (datetime)InpLinesAhead * 86400) continue;
      string nm = PFX + "ev" + IntegerToString(i);
      ObjectCreate(0, nm, OBJ_VLINE, 0, BarClock(gUp[i].time), 0);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, InpEventColor);
      ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      ObjectSetString(0, nm, OBJPROP_TOOLTIP, gUp[i].ccy + " " + gUp[i].name);
      shown++;
     }
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   datetime now = NowCal();
   MakeLabel("t1", 70, 6, "AT24 NEWS RISK CLOCK", C'230,190,80', 10, true);
   if(gTester)
     {
      MakeLabel("t2", 70, 26, "CALENDAR NOT IN TESTER", clrSlateGray, 11, true);
      MakeLabel("l1", 10, 66, "The economic calendar only exists on a live terminal.", clrSlateGray, 9);
      return;
     }
   //--- next event and last event
   int nx = -1, lst = -1;
   for(int i = 0; i < gUpN; i++)
     {
      if(gUp[i].time >= now) { nx = i; break; }
      lst = i;
     }
   string state = "CLEAR"; color sc = clrLimeGreen;
   if(!gCalOk) { state = "CALENDAR LOADING"; sc = clrSlateGray; }
   else
     {
      long toNext = (nx >= 0) ? (long)(gUp[nx].time - now) : 999999999;
      long sinceLast = (lst >= 0) ? (long)(now - gUp[lst].time) : 999999999;
      if(toNext <= InpNowMin * 60) { state = "RISK WINDOW - NEWS IN " + Span(toNext); sc = clrTomato; }
      else if(sinceLast <= InpAfterMin * 60) { state = "JUST RELEASED " + Span(sinceLast) + " AGO"; sc = clrOrange; }
      else if(toNext <= InpSoonMin * 60) { state = "NEWS SOON - IN " + Span(toNext); sc = clrGold; }
     }
   MakeLabel("t2", 70, 26, state, sc, 11, true);
   long loc = (long)TimeLocal() - (long)TimeCurrent();
   for(int r = 0; r < 3; r++)
     {
      int idx = (nx >= 0) ? nx + r : -1;
      string nm = "l" + IntegerToString(r + 1);
      if(idx >= 0 && idx < gUpN)
        {
         string tt = StringFormat("in %s  %s %s %s", Span((long)(gUp[idx].time - now)), TimeToString(BarClock(gUp[idx].time), TIME_MINUTES), gUp[idx].ccy, gUp[idx].name);
         if(StringLen(tt) > 52) tt = StringSubstr(tt, 0, 52) + "..";
         MakeLabel(nm, 10, 66 + r * 16, tt, r == 0 ? clrWhite : clrSilver, 9);
        }
      else MakeLabel(nm, 10, 66 + r * 16, r == 0 && gCalOk ? "No further events in the loaded window." : "", clrSlateGray, 9);
     }
   MakeLabel("h1", 10, 118, StringFormat("After %s news (last %d days, %d events)", InpCurrencies, InpStudyDays, (int)gStudy[0]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 136, StringFormat("%d-min range after: median %s vs %s on quiet days", InpStudyMin, DoubleToString(gStudy[1], Dg()), DoubleToString(gStudy[2], Dg())), clrWhite, 9);
   MakeLabel("s2", 10, 152, StringFormat("Typical event = %.2fx the quiet-day range", gStudy[3]), clrWhite, 9);
   MakeLabel("s3", 10, 168, StringFormat("At least 1.5x: %.0f%%   at least 2x: %.0f%%   quieter: %.0f%%", gStudy[4], gStudy[5], gStudy[6]), clrWhite, 9);
   MakeLabel("n1", 10, 190, "Size of the move, NOT its direction. Event times", clrSlateGray, 8);
   MakeLabel("n2", 10, 204, StringFormat("are broker server time (PC clock is %+.1f h from it).", (double)loc / 3600.0), clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 News Risk Clock");
   if(InpSoonMin < InpNowMin || InpNowMin < 1 || InpAfterMin < 1 || InpStudyMin < 5 || InpStudyMin > 240 || InpStudyDays < 20 || InpStudyDays > 400)
     {
      Print("AT24 News Risk Clock: soon window >= risk window >= 1 min, study 5-240 min, history 20-400 days.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(PeriodSeconds() > 3600)
     {
      Print("AT24 News Risk Clock: use a chart of H1 or lower.");
      return INIT_PARAMETERS_INCORRECT;
     }
   gTester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!gTester || (InpDashInTester && visual));
   ArrayResize(gStudy, 8);
   for(int z = 0; z < 8; z++) gStudy[z] = 0.0;
   EventSetTimer(5);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void Refresh();

//--- the timer keeps the countdown and the alert alive between ticks
void OnTimer() { Refresh(); UpdateDash(); }

void Refresh()
  {
   if(gTester) return;
   RefreshClock();
   datetime now = NowCal();
   //--- calendar: reload every 10 minutes; while empty, retry every 10 seconds (the terminal syncs it in the background)
   if(gLoadAt == 0 || now - gLoadAt >= (gCalOk ? 600 : 10))
     {
      gLoadAt = now;
      gUpN = LoadEvents(now - 86400, now + 3 * 86400, gUp);
      gCalOk = (gUpN > 0);
      DrawLines();
     }
   //--- alert once per event when it enters the risk window
   if(InpAlertSoon && gCalOk)
     {
      for(int i = 0; i < gUpN; i++)
        {
         if(gUp[i].time < now) continue;
         if((long)(gUp[i].time - now) <= InpNowMin * 60 && gAlerted != gUp[i].time)
           {
            gAlerted = gUp[i].time;
            string msg = StringFormat("AT24 News Risk Clock: %s %s at %s (in %s)", gUp[i].ccy, gUp[i].name, Hm(gUp[i].time), Span((long)(gUp[i].time - now)));
            Alert(msg);
            if(InpAlertPush) SendNotification(msg);
           }
         break;
        }
     }
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 200) return 0;
   Refresh();
   //--- statistics: rebuilt every 30 minutes on closed bars (history events vs the same clock time on quiet days)
   datetime now = NowCal();
   if(!gTester && (InpCalClock != NW_CLK_TERMINAL || gClk.ok) && (gStudyAt == 0 || now - gStudyAt >= 1800))
     {
      int total = rates_total - 1;
      int bars = (int)MathMin((double)total, (double)InpStudyDays * 86400.0 / PeriodSeconds());
      int base = total - bars;
      NwEvent hist[];
      int hn = LoadEvents(time[base] - 86400, (InpCalClock == NW_CLK_TERMINAL) ? NowCal() : time[total - 1], hist);
      if(hn > 0)
        {
         datetime t[]; double h[], l[];
         ArrayResize(t, bars); ArrayResize(h, bars); ArrayResize(l, bars);
         for(int q = 0; q < bars; q++) { t[q] = time[base + q]; h[q] = high[base + q]; l[q] = low[base + q]; }
         datetime et[]; int m = 0;
         for(int i = 0; i < hn; i++) if(BarClock(hist[i].time) >= t[0] && BarClock(hist[i].time) <= t[bars - 1]) { ArrayResize(et, m + 1); et[m] = BarClock(hist[i].time); m++; }
         ArraySort(et);
         double ratio[];
         AT24NW_Study(bars, t, h, l, et, m, MathMax(1, InpStudyMin * 60 / PeriodSeconds()), 3600, ratio, gStudy);
         gStudyAt = now;
        }
     }
   int nx = -1;
   for(int i = 0; i < gUpN; i++) if(gUp[i].time >= now) { nx = i; break; }
   B0[0] = nx >= 0 ? (double)(gUp[nx].time - now) / 60.0 : -1.0;
   B1[0] = gStudy[3]; B2[0] = gStudy[4]; B3[0] = gUpN; B4[0] = gCalOk ? 1.0 : 0.0;
   UpdateDash();
   return rates_total;
  }
