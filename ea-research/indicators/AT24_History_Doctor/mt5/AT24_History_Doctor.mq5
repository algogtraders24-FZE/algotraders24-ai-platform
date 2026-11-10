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
#property version   "1.00"
#property description "AT24 History Doctor - audits the hourly history of the chart symbol: usable-from date, spread coverage, broken bars, missing hours."
#property description "It places no trades and gives no signals."
#property indicator_chart_window
#property indicator_buffers 4
#property indicator_plots   0

#include "AT24_HD_Core.mqh"

#resource "hd_logo56.bmp"

input group "=== Audit ==="
input int    InpMaxBars       = 40000;  // Hourly bars to audit (most recent)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[], B3[];
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
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS); SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 History Doctor");
   if(InpMaxBars < 1000 || InpMaxBars > 200000)
     {
      Print("AT24 History Doctor: bars to audit must be 1000-200000.");
      return INIT_PARAMETERS_INCORRECT;
     }
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
   if(rates_total < 10) return 0;
   Refresh();
   Draw();
   return rates_total;
  }
