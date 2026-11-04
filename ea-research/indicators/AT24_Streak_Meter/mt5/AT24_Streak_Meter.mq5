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
#property version   "1.00"
#property description "AT24 Streak Meter - current candle streak + how often streaks of each length continued (n, 95 % interval, baseline)."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_SK_Core.mqh"

#resource "sk_logo56.bmp"

input group "=== Streaks ==="
input ENUM_TIMEFRAMES InpTf   = PERIOD_D1;  // Timeframe of the candles counted
input int    InpBars          = 3000;   // Candles analysed
input group "=== Look ==="
input color  InpUpColor       = clrLimeGreen;  // Up streak
input color  InpDownColor     = clrTomato;     // Down streak
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[];
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
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Streak Meter");
   if(InpBars < 400 || InpBars > 50000)
     {
      Print("AT24 Streak Meter: candles analysed 400-50000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int z = 0; z < 14; z++) gSt[z] = 0.0;
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
