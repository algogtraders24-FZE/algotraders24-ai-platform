//+------------------------------------------------------------------+
//| AT24 History Doctor (MT5)                                        |
//| Check your broker data BEFORE you trust any statistic:           |
//| how much of it is real hourly data, where the spread field is    |
//| empty, whether bars are broken or missing. One verdict + table.  |
//| Research tool. Not a signal.                                     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#property version   "1.00"
#property description "AT24 History Doctor - audits the hourly history of the chart symbol: usable-from date, spread coverage, broken bars, missing hours."
#property description "It places no trades and gives no signals."

#include "AT24_HD_Core.mqh"

#define AT24_PRODUCT_ID "HISTORY-DOCTOR-MT4"
#include "AT24_LicenseGate.mqh"

#resource "hd_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input bool InpSaveSnapshot = false;  // Save one chart screenshot to MQL4/Files a few seconds after loading
input string grp1_ = "=== Audit ===";
input int    InpMaxBars       = 40000;  // Hourly bars to audit (most recent)
input string grp2_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[1], B1[1], B2[1], B3[1];
string PFX = "AT24HD_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24HD_Audit gA;
datetime gValid = 0, gSpr = 0;
datetime gBuiltAt = 0;

#define DASH_W 380
#define DASH_H 292

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::hd_logo56.bmp");
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
   MakeLabel("t1", 70, 6, "AT24 HISTORY DOCTOR", C'230,190,80', 10, true);
   if(gBars < 500)
     {
      MakeLabel("t2", 70, 26, "LOADING HOURLY HISTORY", clrSlateGray, 11, true);
      return;
     }
   bool sparse = (gA.validFrom > 0);
   bool zeroSp = (gA.spreadFrom != 0);
   bool broken = (gA.invalid > 0 || gA.nonMonotonic > 0);
   string verdict; color vc;
   if(gA.validFrom < 0) { verdict = "NO HOURLY HISTORY"; vc = clrTomato; }
   else if(broken) { verdict = "BROKEN BARS FOUND"; vc = clrTomato; }
   else if(sparse || zeroSp) { verdict = "PARTLY USABLE"; vc = clrGold; }
   else { verdict = "CLEAN"; vc = clrLimeGreen; }
   MakeLabel("t2", 70, 26, verdict + "  -  " + _Symbol, vc, 11, true);
   MakeLabel("t3", 70, 42, gA.validFrom < 0 ? "no day with 20+ hourly bars" : StringFormat("hourly data usable from %s", TimeToString(gValid, TIME_DATE)), clrWhite, 9, true);
   MakeLabel("t4", 70, 56, gA.spreadFrom < 0 ? "spread field empty (0) in all audited years" : (gA.spreadFrom == 0 ? "spread field filled for the whole range" : StringFormat("spread field >95 %% filled from %s", TimeToString(gSpr, TIME_DATE))), clrSilver, 8);
   //--- yearly table, last 10 years that have bars
   int rows = 0, first = AT24HD_YEARS;
   for(int y = AT24HD_YEARS - 1; y >= 0 && rows < 10; y--) if(gA.years[y].bars > 0) { first = y; rows++; }
   MakeLabel("h0", 10, 76, "year    bars   hourly days   spread=0", clrSlateGray, 8, true);
   int r = 0;
   for(int y = first; y < AT24HD_YEARS; y++)
     {
      if(gA.years[y].bars == 0) continue;
      AT24HD_Year yr = gA.years[y];
      double fd = yr.days > 0 ? (double)yr.fullDays / yr.days : 0.0;
      double zs = (double)yr.zeroSpread / yr.bars;
      color c = (fd < 0.5) ? clrTomato : ((fd < 0.9 || zs > 0.05) ? clrGold : clrLimeGreen);
      MakeLabel("r" + IntegerToString(r), 10, 92 + r * 14, StringFormat("%d   %5d   %3d / %3d     %3.0f %%", yr.year, yr.bars, yr.fullDays, yr.days, zs * 100.0), c, 8);
      r++;
     }
   int y2 = 92 + r * 14 + 6;
   MakeLabel("i1", 10, y2, StringFormat("broken bars %d   order errors %d   missing hours %d (%d breaks)", gA.invalid, gA.nonMonotonic, gA.gapHours, gA.gapCount), (gA.invalid + gA.nonMonotonic) > 0 ? clrTomato : clrSilver, 8);
   MakeLabel("n1", 10, y2 + 16, "Do not trust hour or spread statistics before these dates.", clrSlateGray, 8);
   MakeLabel("f1", 10, DASH_H - 24, "Audit of your terminal data. Not a signal.", clrSlateGray, 7);
   MakeLabel("f2", 10, DASH_H - 13, StringFormat("%d hourly bars checked. algotraders24.ai", gBars), clrSlateGray, 7);
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, PERIOD_H1, 1, MathMax(InpMaxBars, 1000), rr);
   if(n < 500) { gBars = MathMax(n, 0); return false; }
   datetime t[]; double o[], h[], l[], c[]; int sp[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(sp, n);
   for(int i = 0; i < n; i++) { t[i] = rr[i].time; o[i] = rr[i].open; h[i] = rr[i].high; l[i] = rr[i].low; c[i] = rr[i].close; sp[i] = (int)rr[i].spread; }
   AT24HD_Run(n, t, o, h, l, c, sp, gA);
   gBars = n;
   gValid = gA.validFrom >= 0 ? t[gA.validFrom] : 0;
   gSpr = gA.spreadFrom >= 0 ? t[gA.spreadFrom] : 0;
   B0[0] = gA.validFrom; B1[0] = gA.spreadFrom; B2[0] = gA.invalid; B3[0] = gA.gapHours;
   return true;
  }

void Refresh()
  {
   datetime hourNow = (datetime)(((long)TimeCurrent() / 3600) * 3600);
   if(gBuiltAt != hourNow) { if(Rebuild()) gBuiltAt = hourNow; }
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(2); g_initT = TimeLocal();
   if(InpMaxBars < 1000 || InpMaxBars > 200000)
     {
      Print("AT24 History Doctor: bars to audit must be 1000-200000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   
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
