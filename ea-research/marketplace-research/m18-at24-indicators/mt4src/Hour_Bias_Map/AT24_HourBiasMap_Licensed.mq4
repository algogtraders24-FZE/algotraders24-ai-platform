//+------------------------------------------------------------------+
//| AT24 Hour Bias Map (MT5)                                         |
//| Does price lean up or down at certain New York hours? Mean       |
//| return per hour with significance, a chance-level check for 24   |
//| hours, and whether the pattern held from the first half of the   |
//| history to the second.                                           |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#define TimeTradeServer TimeCurrent
#property version   "1.00"
#property description "AT24 Hour Bias Map - hourly return bias by New York hour (DST-aware) with t-stats and a persistence check."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."

#include "AT24_ServerClock.mqh"
#include "AT24_HB_Core.mqh"

#define AT24_PRODUCT_ID "HOUR-BIAS-MAP-MT4"
#include "AT24_LicenseGate.mqh"

#resource "hb_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input string grp1_ = "=== History ===";
input int    InpHistoryDays   = 900;    // Days of hourly history used
input string grp2_ = "=== Clock ===";
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (recommended)
input int    InpManualBase    = -99;    // Broker clock: winter offset from GMT in hours (-99 = detect automatically)
input ENUM_AT24SC_RULE InpManualRule = AT24SC_US; // Broker clock: daylight rule when set manually (1 none, 2 US, 3 EU)
input string grp3_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

input bool InpSaveSnapshot = false;  // Save one chart screenshot to MQL4/Files a few seconds after loading
double B0[1], B1[1], B2[1], B3[1], B4[1];
string PFX = "AT24HB_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gNyHour = 0, gBars = 0;
double gOut[], gSum[];
datetime gBuiltAt = 0, gFirst = 0, gLast = 0;
AT24SC_Clock gClk;
datetime gClkAt = 0;
int      gMeas[];
datetime gUtc[];

#define DASH_W 360
#define DASH_H 262

void RefreshClock()
  {
   if(!InpDstAware) { gClk.ok = false; return; }
   if(InpManualBase != -99) { if(!gClk.ok || gClkAt == 0) { AT24SC_SetManual(gClk, InpManualBase, (int)InpManualRule); gClkAt = TimeCurrent(); } return; }
   if(gClkAt != 0 && TimeCurrent() - gClkAt < (gClk.ok ? 3600 : 10)) return;
   AT24SC_DetectAny(_Symbol, gClk, 60, gMeas, gUtc);
   gClkAt = TimeCurrent();
  }

bool UseClock() { return (InpDstAware && gClk.ok); }

datetime ToGmt(const datetime serverTime)
  {
   if(UseClock()) return AT24SC_ToGmt(gClk, serverTime);
   int off = (int)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;
   return serverTime - (datetime)off;
  }

int NyHour(const datetime serverTime)
  {
   datetime g = ToGmt(serverTime);
   datetime ny = g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600);
   return (int)(((long)ny % 86400) / 3600);
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
   ObjectSetInteger(0, n, OBJPROP_XSIZE, MathMax(1, w));
   ObjectSetInteger(0, n, OBJPROP_YSIZE, MathMax(1, h));
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

void BuildFrame()
  {
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40', C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::hb_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 HOUR BIAS MAP", C'230,190,80', 10, true);
   if(gBars < 2000)
     {
      MakeLabel("t2", 70, 26, "NOT ENOUGH HOURLY HISTORY", clrSlateGray, 11, true);
      return;
     }
   int hh = gNyHour;
   double n = gOut[hh * AT24HB_COLS], mean = gOut[hh * AT24HB_COLS + 1], t = gOut[hh * AT24HB_COLS + 2], up = gOut[hh * AT24HB_COLS + 3];
   string verdict = n < 3 ? "NO DATA FOR THIS HOUR" : (MathAbs(t) >= 3.0 ? "CLEAR BIAS THIS HOUR (in the past)" : (MathAbs(t) >= 1.96 ? "WEAK BIAS THIS HOUR" : "NO BIAS THIS HOUR"));
   color vc = n < 3 ? clrSlateGray : (MathAbs(t) >= 3.0 ? clrGold : (MathAbs(t) >= 1.96 ? clrOrange : clrSlateGray));
   MakeLabel("t2", 70, 26, StringFormat("NY %02d:00  %s", hh, verdict), vc, 9, true);
   //--- histogram of mean return by New York hour
   double mx = 0.0;
   for(int h = 0; h < 24; h++) mx = MathMax(mx, MathAbs(gOut[h * AT24HB_COLS + 1]));
   if(mx <= 0.0) mx = 1.0;
   int x0 = 10, base = 96, maxH = 30;
   MakeRect("axis", x0, base, 336, 1, C'90,100,120', C'90,100,120');
   for(int h = 0; h < 24; h++)
     {
      double m = gOut[h * AT24HB_COLS + 1], tt = gOut[h * AT24HB_COLS + 2], cnt = gOut[h * AT24HB_COLS];
      int hgt = (int)MathRound(maxH * MathAbs(m) / mx);
      bool pos = m >= 0.0;
      bool sig3 = (MathAbs(tt) >= 3.0), sig2 = (MathAbs(tt) >= 1.96);
      color col = cnt < 3 ? C'40,50,70' : (pos ? (sig2 ? clrLimeGreen : C'40,100,60') : (sig2 ? clrTomato : C'120,60,60'));
      color bd = (h == hh) ? clrWhite : (sig3 ? clrGold : col);
      int y = pos ? base - hgt : base + 1;
      MakeRect("bar" + IntegerToString(h), x0 + h * 14, y, 11, MathMax(hgt, 1), col, bd);
     }
   MakeLabel("ax0", x0, base + 33, "0", clrSlateGray, 7);
   MakeLabel("ax6", x0 + 6 * 14, base + 33, "6", clrSlateGray, 7);
   MakeLabel("ax12", x0 + 12 * 14, base + 33, "12", clrSlateGray, 7);
   MakeLabel("ax18", x0 + 18 * 14, base + 33, "18", clrSlateGray, 7);
   MakeLabel("axt", x0 + 22 * 14 - 18, base + 33, "NY hour", clrSlateGray, 7);
   MakeLabel("l1", 10, 150, StringFormat("This hour: mean %+.1f bp per hour, t %+.2f, up %.0f%% (n=%d)", mean, t, up, (int)n), clrWhite, 9);
   MakeLabel("l2", 10, 166, StringFormat("Halves of history: %+.1f bp then %+.1f bp", gOut[hh * AT24HB_COLS + 4], gOut[hh * AT24HB_COLS + 5]), clrSilver, 9);
   MakeLabel("h1", 10, 186, StringFormat("24 hours: %d with |t|>=1.96 (chance ~1), %d with |t|>=3", (int)gSum[0], (int)gSum[1]), C'230,190,80', 8, true);
   MakeLabel("s1", 10, 202, StringFormat("Same sign in both halves: %d of 24 hours (corr %+.2f)", (int)gSum[3], gSum[2]), clrWhite, 8);
   MakeLabel("n1", 10, 218, "Bars = mean return per hour (bp). Gold's drift lifts most.", clrSlateGray, 7);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, StringFormat("not a signal or a forecast. %d hourly bars. algotraders24.ai", gBars), clrSlateGray, 7);
  }

//--- some brokers store older years as two bars per day: only use history from the first day that has at least 20 hourly bars
int ValidFrom(const MqlRates &r[], const int n)
  {
   int i = 0;
   while(i < n)
     {
      long dk = (long)r[i].time / 86400;
      int j = i;
      while(j < n && (long)r[j].time / 86400 == dk) j++;
      if(j - i >= 20) return i;
      i = j;
     }
   return n;
  }

bool Rebuild()
  {
   MqlRates r[];
   int want = InpHistoryDays * 24 + 50;
   int n = CopyRates(_Symbol, PERIOD_H1, 1, want, r);
   if(n < 2000) { gBars = MathMax(n, 0); return false; }
   int v0 = ValidFrom(r, n);
   n -= v0;
   if(n < 2000) { gBars = MathMax(n, 0); return false; }
   double ret[]; int hr[]; ArrayResize(ret, n); ArrayResize(hr, n);
   for(int i = 0; i < n; i++) { ret[i] = MathLog(r[v0 + i].close / r[v0 + i].open); hr[i] = NyHour(r[v0 + i].time); }
   AT24HB_Stats(n, ret, hr, gOut, gSum);
   gBars = n; gFirst = r[v0].time; gLast = r[v0 + n - 1].time;
   B0[0] = gSum[0]; B1[0] = gSum[1]; B2[0] = gSum[2]; B3[0] = gSum[3]; B4[0] = n;
   return true;
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(2); g_initT = TimeLocal();
   if(InpHistoryDays < 120 || InpHistoryDays > 3000)
     {
      Print("AT24 Hour Bias Map: history 120-3000 days.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gOut, 24 * AT24HB_COLS); ArrayResize(gSum, 4);
   for(int z = 0; z < 24 * AT24HB_COLS; z++) gOut[z] = 0.0;
   for(int z = 0; z < 4; z++) gSum[z] = 0.0;
   
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

//--- hourly history of another timeframe is built on demand: retry every few seconds until it is there, then once an hour
void Refresh()
  {
   RefreshClock();
   datetime hourNow = (datetime)(((long)TimeCurrent() / 3600) * 3600);
   if(gBuiltAt != hourNow && (!InpDstAware || gClk.ok)) { if(Rebuild()) gBuiltAt = hourNow; }
  }


int AT24_Calc(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 10) return 0;
   Refresh();
   gNyHour = NyHour(time[rates_total - 1]);
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
