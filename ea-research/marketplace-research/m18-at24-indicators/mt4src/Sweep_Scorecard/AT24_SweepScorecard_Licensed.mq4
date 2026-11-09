//+------------------------------------------------------------------+
//| AT24 Sweep Scorecard (MT5)                                       |
//| The popular "Asian range sweep" setup, graded honestly: every    |
//| sweep in R with costs, the reversal trade next to the mirror     |
//| trade and a random-direction control. Losers are shown.          |
//| Research tool. Not a signal. Past behaviour does not predict.    |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#define TimeTradeServer TimeCurrent
#property version   "1.00"
#property description "AT24 Sweep Scorecard - Asian-range sweeps graded in R (reversal vs continuation vs random direction), costs included."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Descriptive history on your broker's data. It places no trades. Not a signal."

#include "AT24_ServerClock.mqh"
#include "AT24_SW_Core.mqh"

#define AT24_PRODUCT_ID "SWEEP-SCORECARD-MT4"
#include "AT24_LicenseGate.mqh"

#resource "sw_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input string grp1_ = "=== Setup (GMT hours) ===";
input int    InpAsiaEnd       = 7;      // Asian range = GMT hours before this
input int    InpWindowEnd     = 12;     // Sweep window = from the Asian end to this GMT hour (inclusive)
input int    InpExitHour      = 16;     // Time exit at this GMT hour
input double InpCost          = 0.25;   // Cost per trade in PRICE units (spread + slippage; 0.25 = 25 cents on gold)
input int    InpRecent        = 250;    // "Recent" = this many latest sweeps
input string grp2_ = "=== Look ===";
input int    InpDaysShown     = 6;      // Days of Asian boxes / sweep marks drawn
input color  InpBoxColor      = C'50,60,90';
input color  InpWinColor      = clrLimeGreen;
input color  InpLossColor     = clrTomato;
input string grp3_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input string grp4_ = "=== Alerts ===";
input bool   InpAlertSweep    = false;  // Alert when a new sweep is confirmed
input bool   InpAlertPush     = false;  // Also send push notification

input bool InpSaveSnapshot = false;  // Save one chart screenshot to MQL4/Files a few seconds after loading
double B0[1], B1[1], B2[1], B3[1], B4[1];
string PFX = "AT24SW_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24SW_Event gEv[];
int    gM = 0;
double gAll[11], gRec[11];
datetime gBuiltAt = 0, gAlerted = 0;
datetime gT[];                       // times of the valid bars (for drawing)
double gTodayHi = 0.0, gTodayLo = 0.0; int gTodayState = 0;   // 0 no data/forming, 1 range set (window open), 2 swept up, 3 swept down, 4 window over without sweep
string gTodayInfo = "";
AT24SC_Clock gClk;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

#define DASH_W 360
#define DASH_H 262

void RefreshClock()
  {
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_Detect(_Symbol, gClk, 60, gMeas, gUtc);
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sw_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

void DrawHistory()
  {
   ObjectsDeleteAll(0, PFX + "bx");
   ObjectsDeleteAll(0, PFX + "sw");
   int shown = 0;
   for(int k = gM - 1; k >= 0 && shown < InpDaysShown; k--, shown++)
     {
      string nm = PFX + "bx" + IntegerToString(k);
      datetime t1 = gT[gEv[k].asiaFirst], t2 = gT[gEv[k].bar] + PeriodSeconds() * 3;
      ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, gEv[k].asiaHi, t2, gEv[k].asiaLo);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, InpBoxColor);
      ObjectSetInteger(0, nm, OBJPROP_FILL, true);
      ObjectSetInteger(0, nm, OBJPROP_BACK, true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
      string tx = PFX + "sw" + IntegerToString(k);
      bool win = gEv[k].rev > 0.0;
      ObjectCreate(0, tx, OBJ_TEXT, 0, gT[gEv[k].bar], gEv[k].dir == -1 ? gEv[k].ext : gEv[k].ext);
      ObjectSetString(0, tx, OBJPROP_TEXT, StringFormat("%s sweep: reversal %+.1fR", gEv[k].dir == -1 ? "high" : "low", gEv[k].rev));
      ObjectSetInteger(0, tx, OBJPROP_COLOR, win ? InpWinColor : InpLossColor);
      ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
      ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
      ObjectSetInteger(0, tx, OBJPROP_ANCHOR, gEv[k].dir == -1 ? ANCHOR_LOWER : ANCHOR_UPPER);
      ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
     }
  }

string Verdict(const double t, const double md)
  {
   if(t <= -2.0) return "THIS SETUP HAS LOST MONEY (net of costs)";
   if(t >= 2.0) return "THIS SETUP HAS MADE MONEY (net of costs)";
   return "NOT CLEARLY DIFFERENT FROM ZERO";
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 SWEEP SCORECARD", C'230,190,80', 10, true);
   if(gBars < 3000 || !gClk.ok || gM < 30)
     {
      MakeLabel("t2", 70, 26, "LOADING HOURLY HISTORY", clrSlateGray, 11, true);
      return;
     }
   MakeLabel("t2", 70, 26, gTodayInfo, gTodayState == 2 || gTodayState == 3 ? clrGold : clrWhite, 10, true);
   MakeLabel("h1", 10, 56, StringFormat("%d Asian-range sweeps since %s, graded in R", gM, TimeToString(gT[0], TIME_DATE)), C'230,190,80', 9, true);
   MakeLabel("r1", 10, 74, StringFormat("Reversal      %+.2f R per trade  (hit %.0f%%, t %+.1f)", gAll[1], gAll[3], gAll[2]), gAll[1] < 0 ? clrTomato : clrLimeGreen, 9, true);
   MakeLabel("r2", 10, 90, StringFormat("Continuation  %+.2f R per trade  (hit %.0f%%)", gAll[4], gAll[6]), clrWhite, 9);
   MakeLabel("r3", 10, 106, StringFormat("Random direction (control)  %+.2f R", gAll[7]), clrSilver, 9);
   MakeLabel("r4", 10, 122, StringFormat("Reversal minus control  %+.2f R  (t %+.1f)", gAll[8], gAll[9]), clrSilver, 9);
   MakeLabel("r5", 10, 142, StringFormat("Latest %d sweeps: reversal %+.2f R (t %+.1f), control %+.2f R", (int)gRec[0], gRec[1], gRec[2], gRec[7]), clrWhite, 8);
   MakeLabel("v1", 10, 164, Verdict(gAll[2], gAll[1]), gAll[2] <= -2.0 ? clrTomato : (gAll[2] >= 2.0 ? clrLimeGreen : clrGold), 9, true);
   MakeLabel("n1", 10, 184, StringFormat("1R = entry to sweep extreme (typical %.2f). Target 1R,", gAll[10]), clrSlateGray, 8);
   MakeLabel("n2", 10, 198, StringFormat("stop at the extreme, exit GMT %02d:00, cost %.2f, ties = stop.", InpExitHour, InpCost), clrSlateGray, 8);
   MakeLabel("n3", 10, 212, "Compare the reversal with the control, not with zero.", clrSlateGray, 7);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Research tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. No trades placed. algotraders24.ai", clrSlateGray, 7);
  }

//--- state of the CURRENT GMT day from closed bars (the same sweep rule, applied to what exists so far)
void TodayState(const int n, const long &gday[], const int &ghour[], const double &high[], const double &low[], const double &close[], const datetime &t[])
  {
   gTodayState = 0; gTodayInfo = "WAITING FOR TODAY'S ASIAN RANGE";
   long dk = gday[n - 1];
   int i = n - 1; while(i > 0 && gday[i - 1] == dk) i--;
   int na = 0; double hi = -1e300, lo = 1e300;
   for(int k = i; k < n; k++) if(ghour[k] < InpAsiaEnd) { na++; if(high[k] > hi) hi = high[k]; if(low[k] < lo) lo = low[k]; }
   if(ghour[n - 1] < InpAsiaEnd) { gTodayInfo = StringFormat("ASIAN RANGE FORMING (%d bars)", na); gTodayHi = hi; gTodayLo = lo; return; }
   if(na < 6) { gTodayInfo = "NO FULL ASIAN RANGE TODAY"; return; }
   gTodayHi = hi; gTodayLo = lo; gTodayState = 1;
   gTodayInfo = StringFormat("RANGE %s - %s, WATCHING FOR A SWEEP", DoubleToString(lo, Dg()), DoubleToString(hi, Dg()));
   for(int k = i; k < n; k++)
     {
      if(ghour[k] < InpAsiaEnd || ghour[k] > InpWindowEnd) continue;
      bool up = (high[k] > hi && close[k] <= hi), dn = (low[k] < lo && close[k] >= lo);
      if(up && dn) { gTodayState = 4; gTodayInfo = "BOTH SIDES SWEPT: NO SETUP TODAY"; return; }
      if(up) { gTodayState = 2; gTodayInfo = StringFormat("HIGH SWEPT at %s (reversal = short)", TimeToString(t[k], TIME_MINUTES)); return; }
      if(dn) { gTodayState = 3; gTodayInfo = StringFormat("LOW SWEPT at %s (reversal = long)", TimeToString(t[k], TIME_MINUTES)); return; }
     }
   if(ghour[n - 1] > InpWindowEnd) { gTodayState = 4; gTodayInfo = "WINDOW OVER: NO SWEEP TODAY"; }
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n0 = CopyRates(_Symbol, PERIOD_H1, 1, 40000, rr);
   if(n0 < 3000) { gBars = MathMax(n0, 0); return false; }
   //--- never use history that is not hourly (some brokers store older years as two bars per day)
   int v0 = 0;
   { int i = 0; v0 = n0;
     while(i < n0) { long dk = (long)rr[i].time / 86400; int j = i; while(j < n0 && (long)rr[j].time / 86400 == dk) j++; if(j - i >= 20) { v0 = i; break; } i = j; } }
   int n = n0 - v0;
   if(n < 3000) { gBars = n; return false; }
   double o[], h[], l[], c[]; long gday[]; int ghour[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(gday, n); ArrayResize(ghour, n); ArrayResize(gT, n);
   for(int i = 0; i < n; i++)
     {
      MqlRates b = rr[v0 + i];
      o[i] = b.open; h[i] = b.high; l[i] = b.low; c[i] = b.close; gT[i] = b.time;
      datetime g = AT24SC_ToGmt(gClk, b.time);
      gday[i] = (long)g / 86400; ghour[i] = (int)(((long)g % 86400) / 3600);
     }
   gM = AT24SW_Find(n, gday, ghour, o, h, l, c, InpAsiaEnd, InpWindowEnd, InpExitHour, InpCost, 0.5, gEv);
   if(gM < 30) { gBars = n; return false; }
   double st[], st2[];
   AT24SW_Stats(gEv, gM, 0, st); AT24SW_Stats(gEv, gM, MathMax(0, gM - InpRecent), st2);
   for(int z = 0; z < 11; z++) { gAll[z] = st[z]; gRec[z] = st2[z]; }
   gBars = n;
   TodayState(n, gday, ghour, h, l, c, gT);
   DrawHistory();
   if(InpAlertSweep && gTodayState >= 2 && gTodayState <= 3 && gAlerted != (datetime)(gday[n - 1] * 86400))
     {
      gAlerted = (datetime)(gday[n - 1] * 86400);
      string msg = StringFormat("AT24 Sweep Scorecard %s: %s (past reversal result %+.2f R per trade, control %+.2f R)", _Symbol, gTodayInfo, gAll[1], gAll[7]);
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
   B0[0] = gM; B1[0] = gAll[1]; B2[0] = gAll[2]; B3[0] = gAll[7]; B4[0] = gTodayState;
   return true;
  }

void Refresh()
  {
   RefreshClock();
   datetime hourNow = (datetime)(((long)TimeCurrent() / 3600) * 3600);
   if(gBuiltAt != hourNow && gClk.ok) { if(Rebuild()) gBuiltAt = hourNow; }
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(2); g_initT = TimeLocal();
   if(InpAsiaEnd < 4 || InpAsiaEnd > 10 || InpWindowEnd < InpAsiaEnd + 2 || InpWindowEnd > 20 || InpExitHour <= InpAsiaEnd || InpExitHour > 23 || InpCost < 0.0 || InpRecent < 30)
     {
      Print("AT24 Sweep Scorecard: Asian end 4-10, window end at least 2 hours later (max 20), exit after the Asian end (max 23), cost >= 0, recent >= 30.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 11; z++) { gAll[z] = 0.0; gRec[z] = 0.0; }
   
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }


int AT24_Calc(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 10) return 0;
   Refresh();
   Draw();
   return rates_total;
  }

//--- EA driver: the former OnCalculate runs from the timer and on a new bar, behind the licence gate
datetime g_lastBar = 0, g_initT = 0;
bool g_snapDone = false;
void Step()
  {
   if(!AT24Gate_Allowed()) { ObjectsDeleteAll(0, PFX); return; }
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int want = (int)MathMin((double)iBars(_Symbol, _Period), 12000.0);
   int n = CopyRates(_Symbol, _Period, 0, want, r);
   if(n < 10) return;
   datetime tm[]; double op[], hi[], lo[], cl[]; long tv[]; int sp[];
   ArrayResize(tm, n); ArrayResize(op, n); ArrayResize(hi, n); ArrayResize(lo, n); ArrayResize(cl, n); ArrayResize(tv, n); ArrayResize(sp, n);
   for(int q = 0; q < n; q++) { tm[q] = r[q].time; op[q] = r[q].open; hi[q] = r[q].high; lo[q] = r[q].low; cl[q] = r[q].close; tv[q] = r[q].tick_volume; sp[q] = r[q].spread; }
   AT24_Calc(n, g_lastBar == 0 ? 0 : n - 1, tm, op, hi, lo, cl, tv, tv, sp);
   g_lastBar = tm[n - 1];
   if(InpSaveSnapshot && !g_snapDone && g_initT > 0 && TimeLocal() - g_initT >= 6)
     {
      string fn = "AT24_" + MQLInfoString(MQL_PROGRAM_NAME) + "_snapshot.png";
      if(ChartScreenShot(0, fn, 1280, 720, ALIGN_RIGHT)) { g_snapDone = true; Print("snapshot saved ", fn); }
     }
  }

void OnTimer() { AT24Gate_Timer(InpLicenseKey); Step(); }
void OnTick() { if(iTime(_Symbol, _Period, 0) != g_lastBar) Step(); }

void OnChartEventSnap() {}
