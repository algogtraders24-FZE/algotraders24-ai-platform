//+------------------------------------------------------------------+
//| AT24 Weekend Gap Tracker (MT5)                                   |
//| The gap between Friday's close and the reopening, whether it has |
//| been filled, and how often gaps really filled on YOUR symbol -   |
//| against a mirrored control level at the same distance.           |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#property version   "1.00"
#property description "AT24 Weekend Gap Tracker - latest market-closed gap, fill state + real fill statistics vs control level."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."

#include "AT24_WG_Core.mqh"

#define AT24_PRODUCT_ID "WEEKEND-GAP-TRACKER-MT4"
#include "AT24_LicenseGate.mqh"

#resource "wg_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input string grp1_ = "=== Gaps ===";
input double InpMinAtr        = 0.1;    // Ignore gaps smaller than this many ATR (H1)
input int    InpBreakHours    = 12;     // A gap = no bars for more than this many hours
input int    InpHistoryDays   = 900;    // Days of hourly history used
input string grp2_ = "=== Look ===";
input color  InpGapColor      = clrGold;       // Gap level
input color  InpFilledColor   = clrSlateGray;  // Filled gap
input string grp3_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input string grp4_ = "=== Alerts ===";
input bool   InpAlertFill     = false;  // Alert when the latest gap gets filled
input bool   InpAlertPush     = false;  // Also send push notification

input bool InpSaveSnapshot = false;  // Save one chart screenshot to MQL4/Files a few seconds after loading
double B0[1], B1[1], B2[1], B3[1], B4[1];
string PFX = "AT24WG_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gBars = 0;
AT24WG_Gap gG[];
int    gM = 0;
double gSt[11];
datetime gTimes[], gBuiltAt = 0, gLastBar = 0, gAlerted = 0;
double gLastClose = 0.0, gLastHigh = 0.0, gLastLow = 0.0;
bool   gHave = false;

#define DASH_W 360
#define DASH_H 262

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::wg_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

//--- latest gap: still open if no bar since the reopening has reached the old close
bool LatestOpen() { return gM > 0 && gG[gM - 1].fillBar < 0; }

void DrawGap()
  {
   ObjectsDeleteAll(0, PFX + "gp");
   if(gM == 0) return;
   AT24WG_Gap g = gG[gM - 1];
   datetime t1 = gTimes[g.bar];
   datetime t2 = TimeCurrent() + PeriodSeconds() * 14;
   bool open = (g.fillBar < 0);
   color col = open ? InpGapColor : InpFilledColor;
   string z = PFX + "gpz";
   ObjectCreate(0, z, OBJ_RECTANGLE, 0, t1, g.open, t2, g.prevClose);
   ObjectSetInteger(0, z, OBJPROP_COLOR, open ? C'70,60,20' : C'35,40,50');
   ObjectSetInteger(0, z, OBJPROP_FILL, true);
   ObjectSetInteger(0, z, OBJPROP_BACK, true);
   ObjectSetInteger(0, z, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, z, OBJPROP_HIDDEN, true);
   string l = PFX + "gpl";
   ObjectCreate(0, l, OBJ_TREND, 0, t1, g.prevClose, t2, g.prevClose);
   ObjectSetInteger(0, l, OBJPROP_COLOR, col);
   ObjectSetInteger(0, l, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, l, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, l, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, l, OBJPROP_HIDDEN, true);
   string tx = PFX + "gpt";
   ObjectCreate(0, tx, OBJ_TEXT, 0, t2, g.prevClose);
   ObjectSetString(0, tx, OBJPROP_TEXT, StringFormat("%s close  %s", open ? "Friday" : "Friday (filled)", DoubleToString(g.prevClose, Dg())));
   ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
   ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
   ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
  }

string Pct(const double a, const double b) { return StringFormat("%.0f%% (control %.0f%%)", a, b); }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 WEEKEND GAP TRACKER", C'230,190,80', 10, true);
   if(gBars < 2000 || gM == 0)
     {
      MakeLabel("t2", 70, 26, gBars < 2000 ? "LOADING HOURLY HISTORY" : "NO GAPS FOUND", clrSlateGray, 11, true);
      return;
     }
   AT24WG_Gap g = gG[gM - 1];
   bool open = (g.fillBar < 0);
   double sizeAtr = MathAbs(g.size) / g.atr;
   datetime gt = gTimes[g.bar];
   int ageH = (int)(((long)TimeCurrent() - (long)gt) / 3600);
   MakeLabel("t2", 70, 26, StringFormat("LATEST GAP: %s  %s", g.size > 0 ? "UP" : "DOWN", open ? "NOT FILLED" : "FILLED"), open ? clrGold : clrSlateGray, 11, true);
   MakeLabel("l1", 10, 62, StringFormat("Friday close %s -> open %s  (%s, %.2f ATR)", DoubleToString(g.prevClose, Dg()), DoubleToString(g.open, Dg()), DoubleToString(g.size, Dg()), sizeAtr), clrWhite, 9);
   MakeLabel("l2", 10, 78, StringFormat("Reopened %s (%d h ago)%s", TimeToString(gt, TIME_DATE | TIME_MINUTES), ageH, open ? "" : StringFormat(", filled after %d h", g.fillBar - g.bar)), clrSilver, 9);
   MakeLabel("h1", 10, 102, StringFormat("%d gaps measured (>= %.1f ATR, last %d days)", (int)gSt[0], InpMinAtr, InpHistoryDays), C'230,190,80', 9, true);
   MakeLabel("s0", 10, 120, StringFormat("Up %.0f%%   typical size %.2f ATR", gSt[1], gSt[2]), clrWhite, 9);
   MakeLabel("s1", 10, 138, "Filled within 1 h:   " + Pct(gSt[3], gSt[4]), clrWhite, 9);
   MakeLabel("s2", 10, 154, "Filled within 4 h:   " + Pct(gSt[5], gSt[6]), clrWhite, 9);
   MakeLabel("s3", 10, 170, "Filled within 24 h: " + Pct(gSt[7], gSt[8]), clrWhite, 9);
   MakeLabel("s4", 10, 186, "Filled within 5 days: " + Pct(gSt[9], gSt[10]), clrWhite, 9);
   MakeLabel("n1", 10, 206, "Control = a level the same distance on the other side.", clrSlateGray, 8);
   MakeLabel("n2", 10, 220, "Gaps 'fill' about as often as any level that near.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

bool Rebuild()
  {
   MqlRates r[];
   int n = CopyRates(_Symbol, PERIOD_H1, 1, InpHistoryDays * 24 + 50, r);
   if(n < 2000) { gBars = MathMax(n, 0); return false; }
   datetime t[]; double o[], h[], l[], c[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(gTimes, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; gTimes[i] = r[i].time; }
   gM = AT24WG_Find(n, t, o, h, l, c, InpBreakHours * 3600, InpMinAtr, gG);
   int win[4] = {1, 4, 24, 120};
   double st[]; AT24WG_Stats(n, gG, gM, win, 4, st);
   for(int z = 0; z < 11; z++) gSt[z] = st[z];
   gBars = n;
   if(gM > 0)
     {
      B0[0] = gG[gM - 1].size; B1[0] = gG[gM - 1].size / gG[gM - 1].atr; B2[0] = gG[gM - 1].fillBar < 0 ? 0.0 : 1.0; B3[0] = gG[gM - 1].prevClose; B4[0] = gSt[5];
      if(InpAlertFill && gG[gM - 1].fillBar >= 0 && gAlerted != gTimes[gG[gM - 1].bar] && (long)TimeCurrent() - (long)gTimes[gG[gM - 1].fillBar] < 7200)
        {
         gAlerted = gTimes[gG[gM - 1].bar];
         string msg = StringFormat("AT24 Weekend Gap Tracker %s: the weekend gap to %s has been filled", _Symbol, DoubleToString(gG[gM - 1].prevClose, Dg()));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
     }
   DrawGap();
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
   if(InpMinAtr < 0.0 || InpBreakHours < 2 || InpBreakHours > 72 || InpHistoryDays < 120 || InpHistoryDays > 3000)
     {
      Print("AT24 Weekend Gap Tracker: min gap >= 0, break 2-72 hours, history 120-3000 days.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 11; z++) gSt[z] = 0.0;
   
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
