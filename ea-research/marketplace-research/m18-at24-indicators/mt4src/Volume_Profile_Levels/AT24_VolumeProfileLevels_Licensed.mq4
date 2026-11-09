//+------------------------------------------------------------------+
//| AT24 Volume Profile Levels (MT5)                                 |
//| Yesterday's point of control and value area from tick volume,    |
//| drawn across today - and how price really treated such levels on |
//| YOUR symbol against mirrored control levels.                     |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#property version   "1.00"
#property description "AT24 Volume Profile Levels - previous-day POC / VAH / VAL from tick volume + real touch and reaction statistics vs control."
#property description "Tick volume, not exchange volume. Descriptive history. Context tool. Not a signal."

#include "AT24_VP_Core.mqh"

#define AT24_PRODUCT_ID "VOLUME-PROFILE-LEVELS-MT4"
#include "AT24_LicenseGate.mqh"

#resource "vp_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input string grp1_ = "=== Profile ===";
input int    InpBins          = 60;     // Price bins per day
input double InpValueAreaPct  = 70.0;   // Value area, % of the day's volume
input int    InpLookBars      = 24;     // Bars after a touch used to judge the reaction
input double InpReactFrac     = 0.15;   // Reaction size, fraction of the previous day's range
input int    InpHistoryBars   = 8000;   // Bars analysed
input string grp2_ = "=== Look ===";
input bool   InpShowVA        = true;   // Shade the value area
input int    InpDaysShown     = 2;      // Days of levels drawn (today + previous)
input color  InpPocColor      = clrGold;        // Point of control
input color  InpVaColor       = clrDodgerBlue;  // Value area edges
input color  InpVaFill        = C'20,40,70';    // Value area shading
input string grp3_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input string grp4_ = "=== Alerts (bar close) ===";
input bool   InpAlertLevel    = false;  // Alert when price closes through a level
input bool   InpAlertPush     = false;  // Also send push notification

input bool InpSaveSnapshot = false;  // Save one chart screenshot to MQL4/Files a few seconds after loading
double B0[1], B1[1], B2[1], B3[1], B4[1];
string PFX = "AT24VP_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
AT24VP_Day gD[];
int    gN = 0;
double gSt[18];
double gPrice = 0.0, gPoc = 0.0, gVah = 0.0, gVal = 0.0;
int    gSide = 0, gLastSide = -9;
datetime gAlertBar = 0;

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::vp_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

void Line(const string nm, const datetime t1, const datetime t2, const double p, const color col, const int width, const string txt)
  {
   ObjectCreate(0, nm, OBJ_TREND, 0, t1, p, t2, p);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_SOLID);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
   string tx = nm + "t";
   ObjectCreate(0, tx, OBJ_TEXT, 0, t2, p);
   ObjectSetString(0, tx, OBJPROP_TEXT, txt + "  " + DoubleToString(p, Dg()));
   ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
   ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
   ObjectSetString(0, tx, OBJPROP_FONT, "Segoe UI Semibold");
   ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
   ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
  }

void Draw(const int base, const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "ln");
   ObjectsDeleteAll(0, PFX + "va");
   datetime tEnd = time[rates_total - 1] + PeriodSeconds() * 14;
   int shown = 0;
   //--- the profile of day k is drawn across day k+1 (the day it informs); the current day uses the previous day's profile
   for(int k = gN - 2; k >= 0 && shown < InpDaysShown; k--)
     {
      if(!gD[k].ok) continue;
      int nxt = k + 1;
      datetime t1 = time[base + gD[nxt].first];
      datetime t2 = (nxt == gN - 1) ? tEnd : time[base + gD[nxt].last];
      string sk = IntegerToString(k);
      if(InpShowVA)
        {
         string va = PFX + "va" + sk;
         ObjectCreate(0, va, OBJ_RECTANGLE, 0, t1, gD[k].vah, t2, gD[k].val);
         ObjectSetInteger(0, va, OBJPROP_COLOR, InpVaFill);
         ObjectSetInteger(0, va, OBJPROP_FILL, true);
         ObjectSetInteger(0, va, OBJPROP_BACK, true);
         ObjectSetInteger(0, va, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, va, OBJPROP_HIDDEN, true);
        }
      Line(PFX + "lnp" + sk, t1, t2, gD[k].poc, InpPocColor, 2, "POC");
      Line(PFX + "lnh" + sk, t1, t2, gD[k].vah, InpVaColor, 1, "VAH");
      Line(PFX + "lnl" + sk, t1, t2, gD[k].val, InpVaColor, 1, "VAL");
      shown++;
     }
  }

string Row(const int l, const string name)
  {
   double days = gSt[l * 6], tch = gSt[l * 6 + 1], ctl = gSt[l * 6 + 2], rea = gSt[l * 6 + 3], crea = gSt[l * 6 + 4], dec = gSt[l * 6 + 5];
   if(days < 1.0) return name + ": -";
   double hw = (dec > 0.0) ? 1.96 * MathSqrt(MathMax(rea * (100.0 - rea), 0.0) / dec) : 0.0;
   return StringFormat("%s  touched %.0f%% (control %.0f%%)  reacted %.0f%% +-%.0f (control %.0f%%)", name, tch, ctl, rea, hw, crea);
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 VOLUME PROFILE LEVELS", C'230,190,80', 10, true);
   if(gPoc <= 0.0)
     {
      MakeLabel("t2", 70, 26, "NO PREVIOUS-DAY PROFILE", clrSlateGray, 11, true);
      return;
     }
   string pos = gSide == 0 ? "INSIDE YESTERDAY'S VALUE AREA" : (gSide > 0 ? "ABOVE YESTERDAY'S VALUE AREA" : "BELOW YESTERDAY'S VALUE AREA");
   MakeLabel("t2", 70, 26, pos, gSide == 0 ? clrGold : (gSide > 0 ? clrLimeGreen : clrTomato), 10, true);
   MakeLabel("l1", 10, 62, StringFormat("POC %s   VAH %s   VAL %s", DoubleToString(gPoc, Dg()), DoubleToString(gVah, Dg()), DoubleToString(gVal, Dg())), clrWhite, 9);
   MakeLabel("l2", 10, 78, StringFormat("Price %s is %s from POC (%.0f%% of the value-area width)", DoubleToString(gPrice, Dg()), DoubleToString(MathAbs(gPrice - gPoc), Dg()), 100.0 * MathAbs(gPrice - gPoc) / MathMax(gVah - gVal, _Point)), clrSilver, 9);
   MakeLabel("h1", 10, 102, StringFormat("Last %d days: did price touch yesterday's level?", (int)gSt[0]), C'230,190,80', 9, true);
   MakeLabel("s0", 10, 120, Row(0, "POC"), clrWhite, 8);
   MakeLabel("s1", 10, 136, Row(1, "VAH"), clrWhite, 8);
   MakeLabel("s2", 10, 152, Row(2, "VAL"), clrWhite, 8);
   MakeLabel("n1", 10, 176, "Control = same distance from the open on the OTHER side.", clrSlateGray, 8);
   MakeLabel("n2", 10, 190, "Reacted = moved away from the level before breaking it.", clrSlateGray, 8);
   MakeLabel("n3", 10, 204, "Tick volume (broker feed), not exchange volume.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(2); g_initT = TimeLocal();
   if(InpBins < 20 || InpBins > 300 || InpValueAreaPct < 50.0 || InpValueAreaPct > 95.0 || InpLookBars < 1 || InpReactFrac <= 0.0)
     {
      Print("AT24 Volume Profile Levels: bins 20-300, value area 50-95 %, look bars >= 1, reaction fraction > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(PeriodSeconds() > 3600)
     {
      Print("AT24 Volume Profile Levels: use a chart of H1 or lower (the profile is built from intraday bars).");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 18; z++) gSt[z] = 0.0;
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { ObjectsDeleteAll(0, PFX); }

int AT24_Calc(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 600) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: profiles and statistics never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      datetime t[]; double o[], h[], l[], c[], v[];
      ArrayResize(t, nb); ArrayResize(o, nb); ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb); ArrayResize(v, nb);
      for(int q = 0; q < nb; q++) { t[q] = time[base + q]; o[q] = open[base + q]; h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; v[q] = (double)tick_volume[base + q]; }
      gN = AT24VP_Days(nb, t, h, l, v, InpBins, InpValueAreaPct / 100.0, gD);
      double st[];
      AT24VP_Study(nb, o, h, l, c, gD, gN, InpLookBars, InpReactFrac, st);
      for(int z = 0; z < 18; z++) gSt[z] = st[z];
      gPrice = c[nb - 1];
      gPoc = 0.0; gVah = 0.0; gVal = 0.0;
      if(gN >= 2 && gD[gN - 2].ok) { gPoc = gD[gN - 2].poc; gVah = gD[gN - 2].vah; gVal = gD[gN - 2].val; }
      gSide = (gPoc <= 0.0) ? 0 : (gPrice > gVah ? 1 : (gPrice < gVal ? -1 : 0));
      Draw(base, time, rates_total);
      if(InpAlertLevel && gPoc > 0.0 && gLastSide != -9 && gSide != gLastSide && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string msg = StringFormat("AT24 Volume Profile Levels %s: price closed %s yesterday's value area (%s - %s)", _Symbol, gSide == 0 ? "back inside" : (gSide > 0 ? "above" : "below"), DoubleToString(gVal, Dg()), DoubleToString(gVah, Dg()));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      gLastSide = gSide;
      B0[0] = gPoc; B1[0] = gVah; B2[0] = gVal; B3[0] = gSide; B4[0] = gSt[1];
     }
   UpdateDash();
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
