//+------------------------------------------------------------------+
//| AT24 Streak Meter (MT5)                                          |
//| How many same-colour candles in a row right now - and what the   |
//| next candle really did after such streaks on YOUR symbol.        |
//| "After 3 red days a green one is due": is it?                    |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property strict
#property version   "1.00"
#property description "AT24 Streak Meter - current candle streak + how often streaks of each length continued (n, 95 % interval, baseline)."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."

#include "AT24_SK_Core.mqh"

#define AT24_PRODUCT_ID "STREAK-METER-MT4"
#include "AT24_LicenseGate.mqh"

#resource "sk_logo56.bmp"

input string grpL_ = "=== LICENCE ===";
input string InpLicenseKey = "";  // Licence key from your AT24 purchase page (Dashboard > Purchases)
input string grp1_ = "=== Streaks ===";
input ENUM_TIMEFRAMES InpTf   = PERIOD_D1;  // Timeframe of the candles counted
input int    InpBars          = 3000;   // Candles analysed
input string grp2_ = "=== Look ===";
input color  InpUpColor       = clrLimeGreen;  // Up streak
input color  InpDownColor     = clrTomato;     // Down streak
input string grp3_ = "=== Dashboard ===";
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

input bool InpSaveSnapshot = false;  // Save one chart screenshot to MQL4/Files a few seconds after loading
double B0[1], B1[1], B2[1], B3[1], B4[1];
string PFX = "AT24SK_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gN = 0, gCurLen = 0, gCurCol = 0;
double gSt[14];
datetime gBuiltAt = 0;

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sk_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string TfName() { string s = EnumToString(InpTf); StringReplace(s, "PERIOD_", ""); return s; }

string Row(const int k)
  {
   double n = gSt[(k - 1) * 2], p = gSt[(k - 1) * 2 + 1];
   if(n < 1.0) return "-";
   double hw = 1.96 * MathSqrt(MathMax(p * (100.0 - p), 0.0) / n);
   return StringFormat("%d%s in a row: next candle same colour %.0f%% (+-%.0f)  n=%d", k, k == 6 ? "+" : "", p, hw, (int)n);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 STREAK METER", C'230,190,80', 10, true);
   if(gN < 300)
     {
      MakeLabel("t2", 70, 26, "LOADING CANDLES", clrSlateGray, 11, true);
      return;
     }
   string cs = gCurCol > 0 ? "UP" : (gCurCol < 0 ? "DOWN" : "FLAT");
   MakeLabel("t2", 70, 26, StringFormat("%d %s %s IN A ROW", gCurLen, TfName(), cs), gCurCol > 0 ? InpUpColor : (gCurCol < 0 ? InpDownColor : clrSlateGray), 11, true);
   int k = MathMin(MathMax(gCurLen, 1), 6);
   MakeLabel("l1", 10, 62, "After this streak length in the past:", clrSilver, 9);
   MakeLabel("l2", 10, 78, Row(k), clrWhite, 9, true);
   double base = gSt[13];
   MakeLabel("l3", 10, 94, StringFormat("Any candle: next one same colour %.1f%% (n=%d)", base, (int)gSt[12]), clrSilver, 9);
   MakeLabel("h1", 10, 116, StringFormat("All streak lengths (%s candles, %d analysed)", TfName(), gN), C'230,190,80', 9, true);
   for(int j = 1; j <= 6; j++) MakeLabel("r" + IntegerToString(j), 10, 134 + (j - 1) * 14, Row(j), j == k ? clrWhite : clrSlateGray, 8);
   MakeLabel("n1", 10, 222, "~baseline everywhere = no 'due for a reversal' effect.", clrSlateGray, 8);
   MakeLabel("f1", 10, 240, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 251, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

bool Rebuild()
  {
   MqlRates r[];
   int n = CopyRates(_Symbol, InpTf, 1, InpBars, r);
   if(n < 300) { gN = MathMax(n, 0); return false; }
   double o[], c[]; ArrayResize(o, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; c[i] = r[i].close; }
   int len[], col[]; AT24SK_Streaks(n, o, c, len, col);
   double st[]; AT24SK_Stats(n, len, col, 6, st);
   for(int z = 0; z < 14; z++) gSt[z] = st[z];
   gN = n; gCurLen = len[n - 1]; gCurCol = col[n - 1];
   B0[0] = gCurLen * gCurCol; B1[0] = gSt[(MathMin(MathMax(gCurLen, 1), 6) - 1) * 2 + 1]; B2[0] = gSt[(MathMin(MathMax(gCurLen, 1), 6) - 1) * 2]; B3[0] = gSt[13]; B4[0] = n;
   return true;
  }

void Refresh()
  {
   datetime bar = iTime(_Symbol, InpTf, 0);
   if(gBuiltAt != bar || gN < 300) { if(Rebuild()) gBuiltAt = bar; }
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(2); g_initT = TimeLocal();
   if(InpBars < 400 || InpBars > 50000)
     {
      Print("AT24 Streak Meter: candles analysed 400-50000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = IsTesting();
   bool visual = IsVisualMode();
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 14; z++) gSt[z] = 0.0;
   
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
