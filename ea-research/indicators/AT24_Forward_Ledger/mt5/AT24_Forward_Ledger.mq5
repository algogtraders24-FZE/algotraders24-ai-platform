//+------------------------------------------------------------------+
//| AT24 Forward Ledger (MT5)                                        |
//| Candidate trading ideas, registered with a date BEFORE they are  |
//| traded in the ledger. Only trades that start after the date      |
//| count: out-of-sample results, no hindsight, with the market's    |
//| own drift taken out and a multiple-testing threshold.            |
//| Research ledger. Not a signal. Past behaviour does not predict.  |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.02"
#property description "AT24 Forward Ledger - pre-registered candidate rules tallied out-of-sample (n, mean, drift-adjusted, t-stat, verdict)."
#property description "It places NO trades: the ledger replays closed hourly bars. Research tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_ServerClock.mqh"
#include "AT24_FL_Core.mqh"

#resource "fl_logo56.bmp"

input group "=== Ledger ==="
input datetime InpReplayFrom  = 0;      // 0 = official ledger. A date = REPLAY from that date (in-sample, NOT evidence)
input int    InpMinTrades     = 30;     // Trades needed before a verdict is shown
input bool   InpCalUtc        = false;  // Calendar times are UTC (offline terminal); leave off on a connected broker terminal (calendar uses server time)
input group "=== Clock ==="
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (needed for the New York hour)
input int    InpManualBase    = -99;    // Broker clock: winter offset from GMT in hours (-99 = detect automatically)
input ENUM_AT24SC_RULE InpManualRule = AT24SC_US; // Broker clock: daylight rule when set manually (1 none, 2 US, 3 EU)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

//--- the register. Each rule: id, parameter, name, registration time (UTC). Rules are only ever ADDED with later dates, never edited.
#define NRULES 5
datetime gReg[NRULES];
int      gRule[NRULES] = {0, 1, 2, 3, 4};
int      gParam[NRULES] = {18, 0, 0, 0, 0};
string   gName[NRULES] = {"R1  Long the New York 18:00 hour", "R2  Fade an H1 bar of 2.5+ ATR (4 h)", "R3  Follow 1h/4h/24h/120h agreement (24 h)", "R4  Asia follows the last New York session", "R5  Fade a hawkish USD data surprise (2 h)"};

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24FL_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24FL_Stat gSt[NRULES];
datetime gBuiltAt = 0, gFirstValid = 0;
AT24SC_Clock gClk;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

#define DASH_W 360
#define DASH_H 382

void RefreshClock()
  {
   if(!InpDstAware) { gClk.ok = false; return; }
   if(InpManualBase != -99) { if(!gClk.ok || gClkAt == 0) { AT24SC_SetManual(gClk, InpManualBase, (int)InpManualRule); gClkAt = TimeCurrent(); } return; }
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_DetectAny(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::fl_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

datetime StartOf(const int r) { return (InpReplayFrom > 0) ? InpReplayFrom : gReg[r]; }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 FORWARD LEDGER", C'230,190,80', 10, true);
   bool replay = (InpReplayFrom > 0);
   if(replay) MakeLabel("t2", 70, 26, "REPLAY - NOT OUT-OF-SAMPLE", clrTomato, 11, true);
   else
     {
      long days = ((long)TimeGMT() - (long)gReg[0]) / 86400;
      MakeLabel("t2", 70, 26, days < 0 ? StringFormat("OPENS %s", TimeToString(gReg[0], TIME_DATE)) : StringFormat("LEDGER OPEN: DAY %d", (int)days + 1), clrWhite, 11, true);
     }
   if(gBars < 3000 || !gClk.ok)
     {
      MakeLabel("l0", 10, 66, "Loading hourly history / broker clock...", clrSlateGray, 9);
      return;
     }
   double thr = 2.58;      // two-sided z for 0.05 / 5 (five rules registered)
   for(int r = 0; r < NRULES; r++)
     {
      int y = 56 + r * 60;
      AT24FL_Stat s = gSt[r];
      MakeLabel("a" + IntegerToString(r), 10, y, gName[r], C'230,190,80', 8, true);
      MakeLabel("b" + IntegerToString(r), 10, y + 14, StringFormat("from %s  trades %d  mean %+.1f bp  net of drift %+.1f", TimeToString(StartOf(r), TIME_DATE), s.n, s.meanBp, s.adjMeanBp), clrWhite, 8);
      string v; color vc;
      if(s.n < InpMinTrades) { v = StringFormat("COLLECTING %d of %d trades", s.n, InpMinTrades); vc = clrSlateGray; }
      else if(MathAbs(s.tAdj) >= thr) { v = StringFormat("%s  (t %+.2f, beats chance after correction)", s.adjMeanBp > 0 ? "POSITIVE SO FAR" : "NEGATIVE SO FAR", s.tAdj); vc = s.adjMeanBp > 0 ? clrLimeGreen : clrTomato; }
      else { v = StringFormat("NO EDGE SO FAR  (t %+.2f, hit %.0f%%, sum %+.0f bp)", s.tAdj, s.hitPct, s.cumBp); vc = clrSilver; }
      MakeLabel("c" + IntegerToString(r), 10, y + 28, v, vc, 8);
     }
   MakeLabel("n1", 10, 352 - 14, "Rules are only added with later dates, never edited.", clrSlateGray, 7);
   MakeLabel("f1", 10, 358, "Research ledger, not a signal. It replays closed bars; no", clrSlateGray, 7);
   MakeLabel("f2", 10, 370, "trades are placed. Not predictive. algotraders24.ai", clrSlateGray, 7);
  }

//--- hawkish-surprise events for rule R5 (calendar -> same clock as the bars)
datetime gEvT[];
int      gEvD[];
int      gEvN = 0;
string   gSurpNames[10] = {"Nonfarm Payrolls", "Average Hourly Earnings m/m", "CPI m/m", "CPI y/y", "Core CPI m/m", "Core PCE Price Index m/m", "Retail Sales m/m", "ISM Manufacturing PMI", "ISM Non-Manufacturing PMI", "GDP q/q"};

void LoadSurprises(const datetime from)
  {
   gEvN = 0;
   MqlCalendarValue v[];
   int cn = CalendarValueHistory(v, from, TimeTradeServer() + 86400, NULL, "USD");
   if(cn <= 0) return;
   ArrayResize(gEvT, cn); ArrayResize(gEvD, cn);
   for(int i = 0; i < cn; i++)
     {
      if(v[i].actual_value == LONG_MIN || v[i].forecast_value == LONG_MIN) continue;
      MqlCalendarEvent e;
      if(!CalendarEventById(v[i].event_id, e) || (int)e.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      bool ok = false;
      for(int k = 0; k < 10; k++) if(e.name == gSurpNames[k]) { ok = true; break; }
      if(!ok || v[i].actual_value == v[i].forecast_value) continue;
      datetime t = v[i].time;
      if(InpCalUtc) t += (datetime)((long)AT24SC_OffsetHoursAtUtc(gClk, t) * 3600);
      gEvT[gEvN] = t; gEvD[gEvN] = (v[i].actual_value > v[i].forecast_value) ? -1 : 1; gEvN++;
     }
   for(int i = 1; i < gEvN; i++)      // the core needs events in time order
     {
      datetime tt = gEvT[i]; int dd = gEvD[i]; int j = i - 1;
      while(j >= 0 && gEvT[j] > tt) { gEvT[j + 1] = gEvT[j]; gEvD[j + 1] = gEvD[j]; j--; }
      gEvT[j + 1] = tt; gEvD[j + 1] = dd;
     }
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, PERIOD_H1, 1, 40000, rr);
   if(n < 3000) { gBars = MathMax(n, 0); return false; }
   datetime t[]; double o[], h[], l[], c[]; int hr[]; int gh[]; long gd[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(hr, n); ArrayResize(gh, n); ArrayResize(gd, n);
   for(int i = 0; i < n; i++)
     {
      t[i] = rr[i].time; o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; c[i] = rr[i].close;
      datetime g = AT24SC_ToGmt(gClk, rr[i].time);
      hr[i] = (int)(((long)(g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600)) % 86400) / 3600);
      gh[i] = (int)(((long)g % 86400) / 3600); gd[i] = (long)g / 86400;
     }
   //--- never use history that is not hourly (some brokers store older years as two bars per day)
   int v0 = AT24FL_ValidFrom(n, t, 20);
   int m = n - v0;
   if(m < 3000) { gBars = m; return false; }
   datetime tt[]; double oo[], hh[], ll[], cc[]; int hrr[]; int ghh[]; long gdd[];
   ArrayResize(tt, m); ArrayResize(oo, m); ArrayResize(hh, m); ArrayResize(ll, m); ArrayResize(cc, m); ArrayResize(hrr, m); ArrayResize(ghh, m); ArrayResize(gdd, m);
   for(int i = 0; i < m; i++) { tt[i] = t[v0 + i]; oo[i] = o[v0 + i]; hh[i] = h[v0 + i]; ll[i] = l[v0 + i]; cc[i] = c[v0 + i]; hrr[i] = hr[v0 + i]; ghh[i] = gh[v0 + i]; gdd[i] = gd[v0 + i]; }
   for(int r = 0; r < NRULES; r++)
     {
      if(gRule[r] == 3) AT24FL_RunRelay(m, tt, oo, cc, ghh, gdd, StartOf(r), gSt[r]);
      else if(gRule[r] == 4) { LoadSurprises(StartOf(r) - 86400); AT24FL_RunEvents(m, tt, oo, cc, gEvN, gEvT, gEvD, StartOf(r), gSt[r]); }
      else AT24FL_Run(gRule[r], gParam[r], m, tt, oo, hh, ll, cc, hrr, StartOf(r), gSt[r]);
     }
   gBars = m; gFirstValid = tt[0];
   B0[0] = gSt[0].n; B1[0] = gSt[0].adjMeanBp; B2[0] = gSt[0].tAdj; B3[0] = gSt[1].n; B4[0] = gSt[2].n;
   return true;
  }

int      gCalCn = -1;
datetime gCalChk = 0;
void Refresh()
  {
   RefreshClock();
   //--- the calendar syncs in the background: when the number of USD calendar values changes, rebuild (rule R5 depends on it)
   if(TimeCurrent() - gCalChk >= 60)
     {
      gCalChk = TimeCurrent();
      MqlCalendarValue cv[];
      int cn = CalendarValueHistory(cv, D'2026.11.01', TimeTradeServer() + 86400, NULL, "USD");
      if(cn != gCalCn) { if(gCalCn >= 0) gBuiltAt = 0; gCalCn = cn; }
     }
   datetime hourNow = (datetime)(((long)TimeCurrent() / 3600) * 3600);
   if(gBuiltAt != hourNow && gClk.ok) { if(Rebuild()) gBuiltAt = hourNow; }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Forward Ledger");
   if(!InpDstAware || InpMinTrades < 5)
     {
      Print("AT24 Forward Ledger: needs the DST-aware clock (New York hour) and at least 5 trades per verdict.");
      return INIT_PARAMETERS_INCORRECT;
     }
   //--- the register: R1-R3 are registered on 2026-11-10 (UTC), R4 on 2026-11-11. Add future rules BELOW with later dates; never edit these.
   for(int r = 0; r < 3; r++) gReg[r] = D'2026.11.10 00:00';
   gReg[3] = D'2026.11.11 00:00';
   gReg[4] = D'2026.11.12 00:00';
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int r = 0; r < NRULES; r++) { gSt[r].n = 0; gSt[r].meanBp = 0.0; gSt[r].adjMeanBp = 0.0; gSt[r].tAdj = 0.0; gSt[r].hitPct = 0.0; gSt[r].cumBp = 0.0; }
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
