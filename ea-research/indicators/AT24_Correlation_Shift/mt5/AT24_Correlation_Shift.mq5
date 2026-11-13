//+------------------------------------------------------------------+
//| AT24 Correlation Shift Monitor (MT5)                             |
//| Which relationships are changing right now? For pairs you choose |
//| (gold and the dollar, bitcoin and the Nasdaq, gold and oil ...): |
//| the daily-return correlation over 20 and 120 days, how far it    |
//| moved, and where the 20-day value sits in its own history.       |
//| Descriptive. Not a signal.                                       |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Correlation Shift Monitor - short and long correlation of daily returns for chosen pairs, the shift between them and its percentile in history, with optional alerts."
#property description "It places no trades and gives no signals."
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   0

#include "AT24_CS_Core.mqh"

#resource "cs_logo56.bmp"

input group "=== Pairs ==="
input string InpPairs         = "XAUUSD:EURUSD,XAUUSD:USOIL,XAUUSD:US500,BTCUSD:US500,BTCUSD:XAUUSD,EURUSD:USDJPY,US500:USOIL"; // Pairs as A:B, comma separated, symbols exactly as your broker names them (max 20)
input group "=== Windows ==="
input int    InpShortDays     = 20;     // Short window (daily returns)
input int    InpLongDays      = 120;    // Long window (daily returns)
input int    InpHistoryDays   = 750;    // History used for the percentile
input double InpShiftLevel    = 0.40;   // A shift is flagged when the short correlation differs from the long by this much
input group "=== Alerts ==="
input bool   InpAlertShift    = false;  // Alert when a pair becomes shifted (once per pair per daily bar)
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[];
string PFX = "AT24CS_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gW = 700, gH = 200;
string gA[], gB[];
AT24CS_Row gRows[];
int    gNp = 0, gStage = 0;
bool   gCycle = false;
datetime gBuiltBar = 0, gTryAt = 0;
datetime gAlerted[];

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - gW - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - gH - InpDashY) : InpDashY;
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
   ObjectSetInteger(0, n, OBJPROP_XSIZE, gW);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, gH);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::cs_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

color CorrCol(const double c)
  {
   double a = MathMin(1.0, MathAbs(c));
   int hi = 150 + (int)(105 * a), lo = 150 - (int)(80 * a);
   return c >= 0.0 ? (color)(lo | (hi << 8) | (lo << 16)) : (color)(hi | (lo << 8) | (lo << 16));   // green positive, red negative (0x00BBGGRR)
  }

bool Shifted(const AT24CS_Row &r) { return r.ok && MathAbs(r.delta) >= InpShiftLevel; }

string StatusTxt(const AT24CS_Row &r, color &c)
  {
   if(!r.ok) { c = clrSlateGray; return "no data"; }
   if(Shifted(r)) { c = clrGold; return r.delta > 0.0 ? "SHIFTED UP" : "SHIFTED DOWN"; }
   if(r.pct >= 95.0 || r.pct <= 5.0) { c = clrOrange; return "AT AN EXTREME"; }
   c = clrSilver; return "normal";
  }

void Draw()
  {
   if(!gDash) return;
   gH = 96 + gNp * 18 + 66;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 CORRELATION SHIFT", C'230,190,80', 10, true);
   int ok = 0, sh = 0;
   for(int i = 0; i < gNp; i++) { if(!gRows[i].ok) continue; ok++; if(Shifted(gRows[i])) sh++; }
   MakeLabel("t2", 70, 26, StringFormat("%d of %d pairs have shifted by %.2f or more", sh, ok, InpShiftLevel), sh > 0 ? clrGold : clrSilver, 10, true);
   MakeLabel("t3", 70, 42, StringFormat("daily-return correlation: %d-day vs %d-day", InpShortDays, InpLongDays), clrSlateGray, 8);
   int cx[6] = {10, 190, 270, 350, 440, 540};
   string hd[6] = {"Pair", StringFormat("%dd", InpShortDays), StringFormat("%dd", InpLongDays), "Change", "Percentile", "Status"};
   for(int k = 0; k < 6; k++) MakeLabel("h" + IntegerToString(k), cx[k], 66, hd[k], clrSlateGray, 8, true);
   for(int i = 0; i < gNp; i++)
     {
      string id = IntegerToString(i); int y = 84 + i * 18; AT24CS_Row r = gRows[i];
      MakeLabel("a" + id, cx[0], y, gA[i] + " vs " + gB[i], r.ok ? clrWhite : clrTomato, 8, true);
      if(!r.ok) { MakeLabel("b" + id, cx[1], y, "no data / symbol not found", clrTomato, 8); for(int k = 2; k < 6; k++) MakeLabel("c" + IntegerToString(k) + "_" + id, cx[k], y, " ", clrWhite, 8); continue; }
      MakeLabel("b" + id, cx[1], y, StringFormat("%+.2f", r.corrS), CorrCol(r.corrS), 8, true);
      MakeLabel("c2_" + id, cx[2], y, StringFormat("%+.2f", r.corrL), CorrCol(r.corrL), 8);
      MakeLabel("c3_" + id, cx[3], y, StringFormat("%+.2f", r.delta), Shifted(r) ? clrGold : clrSilver, 8, Shifted(r));
      MakeLabel("c4_" + id, cx[4], y, StringFormat("%.0f %%", r.pct), (r.pct >= 95.0 || r.pct <= 5.0) ? clrOrange : clrSilver, 8);
      color sc; string st = StatusTxt(r, sc);
      MakeLabel("c5_" + id, cx[5], y, st, sc, 8, true);
     }
   int y2 = 84 + gNp * 18 + 6;
   MakeLabel("n1", 10, y2, "Percentile = where today's short correlation sits among its own", clrSlateGray, 8);
   MakeLabel("n2", 10, y2 + 13, "values over the history window. Daily bars matched by date.", clrSlateGray, 8);
   MakeLabel("f1", 10, y2 + 36, "Descriptive, not a signal or advice. algotraders24.ai", clrSlateGray, 7);
  }

bool Analyze(const int i)
  {
   AT24CS_Row r; r.ok = false; r.n = 0; r.corrS = r.corrL = r.delta = 0.0; r.pct = 50.0;
   gRows[i] = r;
   if(!SymbolSelect(gA[i], true) || !SymbolSelect(gB[i], true)) return false;
   MqlRates a[], b[];
   int na = CopyRates(gA[i], PERIOD_D1, 1, 3000, a), nb = CopyRates(gB[i], PERIOD_D1, 1, 3000, b);
   if(na < InpLongDays + 20 || nb < InpLongDays + 20) return false;
   datetime ta[], tb[]; double ca[], cb[]; ArrayResize(ta, na); ArrayResize(ca, na); ArrayResize(tb, nb); ArrayResize(cb, nb);
   for(int k = 0; k < na; k++) { ta[k] = a[k].time; ca[k] = a[k].close; }
   for(int k = 0; k < nb; k++) { tb[k] = b[k].time; cb[k] = b[k].close; }
   double oa[], ob[]; int m = AT24CS_Align(na, ta, ca, nb, tb, cb, oa, ob);
   AT24CS_Calc(oa, ob, m, InpShortDays, InpLongDays, InpHistoryDays, r);
   gRows[i] = r;
   return r.ok;
  }

bool AllOk() { for(int i = 0; i < gNp; i++) if(!gRows[i].ok) return false; return true; }

//--- staged work: at most two pairs per call, so the indicator never blocks the terminal
void Refresh()
  {
   datetime bar = iTime(_Symbol, PERIOD_D1, 0);
   if(bar == 0) return;
   if(gBuiltBar != bar && !gCycle) { gCycle = true; gStage = 0; }
   if(!gCycle && !AllOk() && TimeCurrent() - gTryAt >= 10) { gTryAt = TimeCurrent(); for(int i = 0; i < gNp; i++) if(!gRows[i].ok) { Analyze(i); break; } }
   if(!gCycle) return;
   int done = 0;
   while(gStage < gNp && done < 2) { Analyze(gStage); gStage++; done++; }
   if(gStage >= gNp)
     {
      gCycle = false; gBuiltBar = bar;
      int sh = 0; for(int i = 0; i < gNp; i++) if(Shifted(gRows[i])) sh++;
      B0[0] = sh; B1[0] = gNp;
      if(InpAlertShift)
         for(int i = 0; i < gNp; i++)
           {
            if(!Shifted(gRows[i]) || gAlerted[i] == bar) continue;
            gAlerted[i] = bar;
            string msg = StringFormat("AT24 Correlation Shift %s vs %s: %dd correlation %+.2f vs %dd %+.2f (change %+.2f)", gA[i], gB[i], InpShortDays, gRows[i].corrS, InpLongDays, gRows[i].corrL, gRows[i].delta);
            Alert(msg);
            if(InpAlertPush) SendNotification(msg);
           }
     }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Correlation Shift");
   if(InpShortDays < 5 || InpShortDays > 60 || InpLongDays < InpShortDays + 20 || InpLongDays > 500 || InpHistoryDays < InpLongDays || InpHistoryDays > 2500 || InpShiftLevel < 0.1 || InpShiftLevel > 1.5)
     {
      Print("AT24 Correlation Shift: short window 5-60, long window at least short+20 and at most 500, history at least the long window, shift level 0.1-1.5.");
      return INIT_PARAMETERS_INCORRECT;
     }
   string parts[]; int np = StringSplit(InpPairs, ',', parts);
   ArrayResize(gA, 0); ArrayResize(gB, 0); gNp = 0;
   for(int i = 0; i < np && gNp < 20; i++)
     {
      string two[]; if(StringSplit(parts[i], ':', two) != 2) continue;
      string a = two[0], b = two[1]; StringTrimLeft(a); StringTrimRight(a); StringTrimLeft(b); StringTrimRight(b);
      if(a == "" || b == "" || a == b) continue;
      ArrayResize(gA, gNp + 1); ArrayResize(gB, gNp + 1); gA[gNp] = a; gB[gNp] = b; gNp++;
     }
   if(gNp == 0) { Print("AT24 Correlation Shift: no valid pair (use A:B,A:B)."); return INIT_PARAMETERS_INCORRECT; }
   ArrayResize(gRows, gNp); ArrayResize(gAlerted, gNp);
   for(int i = 0; i < gNp; i++) { gRows[i].ok = false; gAlerted[i] = 0; }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   EventSetTimer(3);
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
   if(rates_total < 2) return 0;
   return rates_total;
  }
