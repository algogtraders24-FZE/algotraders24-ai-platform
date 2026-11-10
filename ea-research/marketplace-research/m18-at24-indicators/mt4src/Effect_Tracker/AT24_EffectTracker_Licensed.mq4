//+------------------------------------------------------------------+
//| AT24 Effect Tracker (MT5)                                        |
//| Hour-of-day "effects" are mortal. For each New York hour: is it |
//| statistically alive in the last year, was it alive the year      |
//| before, and when did the average change? Born, alive or dead.    |
//| Research tool. Not a signal. Past behaviour does not predict.    |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#define TimeTradeServer TimeCurrent
#property version   "1.00"
#property description "AT24 Effect Tracker - New York hour effects: alive / newborn / died, with the change point of each hour's average."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Descriptive history on your broker's data. It places no trades. Not a signal."

#include "AT24_ServerClock.mqh"
#include "AT24_ET_Core.mqh"

#define AT24_PRODUCT_ID "EFFECT-TRACKER-MT4"
#include "AT24_LicenseGate.mqh"

#resource "et_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input string grp1_ = "=== Windows ===";
input int    InpDays          = 250;    // Trading days per window (recent window and the one before)
input double InpThreshold     = 2.0;    // |t| needed to call an hour significant
input string grp2_ = "=== Clock ===";
input bool   InpDstAware      = true;   // Detect the broker clock incl. daylight-time rule (needed for the New York hour)
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
string PFX = "AT24ET_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0, gNyHour = 0;
AT24ET_Hour gO[];
double gSum[5];
datetime gT[];
datetime gBuiltAt = 0;
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::et_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string StName(const int s) { return s == AT24ET_ALIVE ? "ALIVE" : (s == AT24ET_BORN ? "NEWBORN" : (s == AT24ET_DIED ? "DIED" : "no effect")); }
color  StCol(const int s) { return s == AT24ET_ALIVE ? clrLimeGreen : (s == AT24ET_BORN ? clrGold : (s == AT24ET_DIED ? clrTomato : clrSlateGray)); }

void Line(const string id, const int y, const AT24ET_Hour &h)
  {
   string when = "";
   if(h.cpBar >= 0 && h.cpBar < gBars && h.cpStat >= 0.9) when = TimeToString(gT[h.cpBar], TIME_DATE);
   MakeLabel(id + "a", 10, y, StringFormat("NY %02d:00  %s", h.hour, StName(h.status)), StCol(h.status), 9, true);
   MakeLabel(id + "b", 10, y + 14, StringFormat("last %dd %+.1f bp (t %+.1f)  before %+.1f bp (t %+.1f)", InpDays, h.meanR, h.tR, h.meanP, h.tP), clrWhite, 8);
   MakeLabel(id + "c", 10, y + 27, when == "" ? "no clear change point" : StringFormat("average changed around %s: %+.1f -> %+.1f bp", when, h.meanBefore, h.meanAfter), clrSilver, 8);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 EFFECT TRACKER", C'230,190,80', 10, true);
   if(gBars < 3000 || !gClk.ok)
     {
      MakeLabel("t2", 70, 26, "LOADING HOURLY HISTORY", clrSlateGray, 11, true);
      return;
     }
   MakeLabel("t2", 70, 26, StringFormat("%d of 24 hours significant now (chance: ~%.1f)", (int)gSum[0], gSum[1]), gSum[0] > gSum[1] + 1.5 ? clrGold : clrWhite, 9, true);
   MakeLabel("t3", 70, 40, StringFormat("alive %d   newborn %d   died %d  (|t| >= %.1f, %d-day windows)", (int)gSum[2], (int)gSum[3], (int)gSum[4], InpThreshold, InpDays), clrSilver, 8);
   //--- the hours that changed status first (alive / newborn / died), most significant first, up to three, then the current hour
   int shown = 0; int used[24]; ArrayInitialize(used, 0); for(int z = 0; z < 24; z++) used[z] = 0;
   for(int k = 0; k < 3; k++)
     {
      int best = -1; double bv = -1.0;
      for(int h = 0; h < 24; h++)
        {
         if(gO[h].status == AT24ET_NONE || used[h] == 1) continue;
         double v = MathMax(MathAbs(gO[h].tR), MathAbs(gO[h].tP));
         if(v > bv) { bv = v; best = h; }
        }
      if(best < 0) break;
      used[best] = 1; Line("e" + IntegerToString(k), 62 + shown * 44, gO[best]); shown++;
     }
   if(shown == 0) MakeLabel("e0a", 10, 66, "No hour is alive, newborn or dead right now.", clrSlateGray, 9);
   if(used[gNyHour] == 0 && shown < 3) Line("cur", 62 + shown * 44, gO[gNyHour]);
   MakeLabel("n1", 10, 222, "Effects are mortal: a significant hour that dies is normal.", clrSlateGray, 8);
   MakeLabel("f1", 10, 240, "Descriptive history on your broker's data. Research tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 251, StringFormat("not a signal. %d hourly bars. algotraders24.ai", gBars), clrSlateGray, 7);
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n0 = CopyRates(_Symbol, PERIOD_H1, 1, 40000, rr);
   if(n0 < 3000) { gBars = MathMax(n0, 0); return false; }
   int v0 = n0, i0 = 0;       // never use history that is not hourly (older years stored as two bars per day)
   while(i0 < n0) { long dk = (long)rr[i0].time / 86400; int j = i0; while(j < n0 && (long)rr[j].time / 86400 == dk) j++; if(j - i0 >= 20) { v0 = i0; break; } i0 = j; }
   int n = n0 - v0;
   if(n < 3000) { gBars = n; return false; }
   double ret[]; int hr[], day[];
   ArrayResize(ret, n); ArrayResize(hr, n); ArrayResize(day, n); ArrayResize(gT, n);
   for(int i = 0; i < n; i++)
     {
      MqlRates b = rr[v0 + i];
      gT[i] = b.time;
      datetime g = AT24SC_ToGmt(gClk, b.time);
      datetime ny = g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600);
      hr[i] = (int)(((long)ny % 86400) / 3600);
      day[i] = (int)(((long)ny + 6 * 3600) / 86400);
      ret[i] = MathLog(b.close / b.open);
     }
   AT24ET_Analyze(n, ret, hr, day, InpDays, InpThreshold, gO, gSum);
   gBars = n;
   gNyHour = hr[n - 1];
   B0[0] = gSum[0]; B1[0] = gSum[2]; B2[0] = gSum[3]; B3[0] = gSum[4]; B4[0] = gNyHour;
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
   if(InpDays < 100 || InpDays > 700 || InpThreshold < 1.0 || InpThreshold > 4.0 || !InpDstAware)
     {
      Print("AT24 Effect Tracker: window 100-700 trading days, threshold 1-4, DST-aware clock on (needed for the New York hour).");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gO, 24);
   for(int z = 0; z < 5; z++) gSum[z] = 0.0;
   for(int h = 0; h < 24; h++) { gO[h].hour = h; gO[h].status = AT24ET_NONE; gO[h].nR = 0; gO[h].meanR = 0; gO[h].tR = 0; gO[h].nP = 0; gO[h].meanP = 0; gO[h].tP = 0; gO[h].cpBar = -1; gO[h].cpStat = 0; gO[h].meanBefore = 0; gO[h].meanAfter = 0; }
   
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
