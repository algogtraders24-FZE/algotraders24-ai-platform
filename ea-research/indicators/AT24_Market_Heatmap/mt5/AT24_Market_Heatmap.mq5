//+------------------------------------------------------------------+
//| AT24 Market Heatmap (MT5)                                        |
//| One panel for forex, metals, energy, indices, stocks and crypto: |
//| today's move, 1/5/21-day change, how big the last daily move was |
//| in ATRs (abnormal moves stand out and can alert), trend, RSI and |
//| where price sits in its 52-week range.                           |
//| Descriptive market overview. Not a signal.                       |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Market Heatmap - multi-asset watchlist: daily changes, move size in ATR, trend, RSI and 52-week range position, with optional alerts for abnormal daily moves."
#property description "It places no trades and gives no signals."
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   0

#include "AT24_HM_Core.mqh"

#resource "hm_logo56.bmp"

enum ENUM_AT24HM_SORT { HM_SORT_LIST = 0, HM_SORT_MOVE = 1, HM_SORT_DAY = 2, HM_SORT_MONTH = 3 };

input group "=== Watchlist ==="
input string InpSymbols       = "XAUUSD,XAGUSD,USOIL,EURUSD,GBPUSD,USDJPY,AUDUSD,US500,USTEC,GER40,BTCUSD,ETHUSD"; // Symbols, comma separated, exactly as your broker names them (max 25)
input ENUM_AT24HM_SORT InpSort = HM_SORT_MOVE; // Sort rows by (list order / biggest move in ATR / today / 21 days)
input group "=== Alerts ==="
input double InpAlertAtr      = 2.0;    // Alert when a closed daily bar moved at least this many ATR (0 = off)
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[];
string PFX = "AT24HM_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gW = 770, gH = 200;
string gList[];
AT24HM_Row gRows[];
int    gNs = 0;
datetime gBuiltBar = 0, gBuiltAt = 0;
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::hm_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

//--- heat colour for a percent change: green up, red down, brighter with size (full at +/- scale)
color HeatC(const double v, const double scale)
  {
   if(v == 0.0) return clrSilver;
   double a = MathMin(1.0, MathAbs(v) / scale);
   int hi = 150 + (int)(105 * a), lo = 150 - (int)(100 * a);
   return v > 0.0 ? (color)(lo | (hi << 8) | (lo << 16)) : (color)(hi | (lo << 8) | (lo << 16));   // colour value is 0x00BBGGRR: red = low byte
  }

string TrendTxt(const int t) { return t > 0 ? "UP" : (t < 0 ? "DOWN" : "RANGE"); }

void Draw()
  {
   if(!gDash) return;
   gH = 100 + gNs * 17 + 56;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 MARKET HEATMAP", C'230,190,80', 10, true);
   int ok = 0, big = 0;
   for(int i = 0; i < gNs; i++) { if(!gRows[i].ok) continue; ok++; if(MathAbs(gRows[i].moveAtr) >= MathMax(InpAlertAtr, 1.5)) big++; }
   MakeLabel("t2", 70, 26, StringFormat("%d symbols, %d with an abnormal last daily move (>= %.1f ATR)", ok, big, MathMax(InpAlertAtr, 1.5)), big > 0 ? clrGold : clrSilver, 9, true);
   MakeLabel("t3", 70, 42, "Daily bars. Changes use closed bars; Today uses the live price.", clrSlateGray, 8);
   int cx[10] = {10, 110, 190, 255, 320, 385, 455, 530, 610, 690};
   string hd[10] = {"Symbol", "Last", "Today", "1D", "5D", "21D", "ATR %", "Move/ATR", "Trend  RSI", "52w pos"};
   for(int k = 0; k < 10; k++) MakeLabel("h" + IntegerToString(k), cx[k], 66, hd[k], clrSlateGray, 8, true);
   //--- order
   int ord[]; ArrayResize(ord, gNs); double key[]; ArrayResize(key, gNs);
   for(int i = 0; i < gNs; i++)
     {
      ord[i] = i;
      if(!gRows[i].ok) key[i] = -1e9;
      else if(InpSort == HM_SORT_MOVE) key[i] = MathAbs(gRows[i].moveAtr);
      else if(InpSort == HM_SORT_DAY) key[i] = gRows[i].ch1;
      else if(InpSort == HM_SORT_MONTH) key[i] = gRows[i].ch21;
      else key[i] = -(double)i;
     }
   for(int i = 1; i < gNs; i++) { int a = ord[i]; int j = i - 1; while(j >= 0 && key[ord[j]] < key[a]) { ord[j + 1] = ord[j]; j--; } ord[j + 1] = a; }
   for(int q = 0; q < gNs; q++)
     {
      int i = ord[q]; string id = IntegerToString(q); int y = 84 + q * 17;
      AT24HM_Row r = gRows[i];
      MakeLabel("a" + id, cx[0], y, gList[i], r.ok ? clrWhite : clrTomato, 8, true);
      if(!r.ok)
        {
         MakeLabel("b" + id, cx[1], y, "no data / symbol not found", clrTomato, 8);
         for(int k = 2; k < 10; k++) MakeLabel("c" + IntegerToString(k) + "_" + id, cx[k], y, " ", clrWhite, 8);
         continue;
        }
      int dg = (int)SymbolInfoInteger(gList[i], SYMBOL_DIGITS);
      double bid = SymbolInfoDouble(gList[i], SYMBOL_BID);
      double today = (bid > 0.0 && r.last > 0.0) ? 100.0 * (bid / r.last - 1.0) : 0.0;
      MakeLabel("b" + id, cx[1], y, DoubleToString(bid > 0.0 ? bid : r.last, dg), clrSilver, 8);
      MakeLabel("c2_" + id, cx[2], y, StringFormat("%+.2f%%", today), HeatC(today, 3.0), 8, true);
      MakeLabel("c3_" + id, cx[3], y, StringFormat("%+.2f%%", r.ch1), HeatC(r.ch1, 3.0), 8);
      MakeLabel("c4_" + id, cx[4], y, StringFormat("%+.1f%%", r.ch5), HeatC(r.ch5, 6.0), 8);
      MakeLabel("c5_" + id, cx[5], y, StringFormat("%+.1f%%", r.ch21), HeatC(r.ch21, 12.0), 8);
      MakeLabel("c6_" + id, cx[6], y, StringFormat("%.2f", r.atrPct), clrSilver, 8);
      bool abn = MathAbs(r.moveAtr) >= MathMax(InpAlertAtr, 1.5);
      MakeLabel("c7_" + id, cx[7], y, StringFormat("%+.1f%s", r.moveAtr, abn ? "  !" : ""), abn ? clrGold : HeatC(r.moveAtr, 2.0), 8, abn);
      MakeLabel("c8_" + id, cx[8], y, StringFormat("%s  %.0f", TrendTxt(r.trend), r.rsi), r.trend > 0 ? clrLimeGreen : (r.trend < 0 ? clrTomato : clrSlateGray), 8);
      MakeLabel("c9_" + id, cx[9], y, StringFormat("%.0f%%", r.rangePos), HeatC(r.rangePos - 50.0, 50.0), 8);
     }
   int y2 = 84 + gNs * 17 + 6;
   MakeLabel("n1", 10, y2, "Move/ATR = last closed daily move in ATRs of the day before; ! marks an abnormal move.", clrSlateGray, 8);
   MakeLabel("f1", 10, y2 + 18, "Descriptive overview, not a signal or advice. algotraders24.ai", clrSlateGray, 7);
  }

bool Analyze(const int i)
  {
   AT24HM_Row r; r.ok = false;
   string sym = gList[i];
   if(!SymbolSelect(sym, true)) { gRows[i] = r; return false; }
   MqlRates rr[]; int n = CopyRates(sym, PERIOD_D1, 1, 1500, rr);
   if(n < 300) { gRows[i] = r; return false; }
   double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int k = 0; k < n; k++) { o[k] = rr[k].open; h[k] = rr[k].high; l[k] = rr[k].low; c[k] = rr[k].close; }
   AT24HM_Calc(n, o, h, l, c, r);
   gRows[i] = r;
   return r.ok;
  }

bool AllOk() { for(int i = 0; i < gNs; i++) if(!gRows[i].ok) return false; return true; }

void Refresh()
  {
   datetime bar = iTime(_Symbol, PERIOD_D1, 0);
   if(bar == 0) return;
   bool fresh = (gBuiltBar != bar);
   bool retry = (!AllOk() && TimeCurrent() - gBuiltAt >= 10);
   if(!fresh && !retry) return;
   for(int i = 0; i < gNs; i++) { if(!fresh && gRows[i].ok) continue; Analyze(i); }
   gBuiltAt = TimeCurrent();
   if(fresh) gBuiltBar = bar;
   if(InpAlertAtr > 0.0)
      for(int i = 0; i < gNs; i++)
        {
         if(!gRows[i].ok || MathAbs(gRows[i].moveAtr) < InpAlertAtr || gAlerted[i] == bar) continue;
         gAlerted[i] = bar;
         string msg = StringFormat("AT24 Market Heatmap %s: last daily move %+.1f ATR (%+.2f%%)", gList[i], gRows[i].moveAtr, gRows[i].ch1);
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
   int big = 0; for(int i = 0; i < gNs; i++) if(gRows[i].ok && MathAbs(gRows[i].moveAtr) >= MathMax(InpAlertAtr, 1.5)) big++;
   B0[0] = big; B1[0] = gNs;
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Market Heatmap");
   if(InpAlertAtr < 0.0 || InpAlertAtr > 10.0)
     {
      Print("AT24 Market Heatmap: alert threshold 0-10 ATR (0 = off).");
      return INIT_PARAMETERS_INCORRECT;
     }
   string parts[]; int np = StringSplit(InpSymbols, ',', parts);
   ArrayResize(gList, 0); gNs = 0;
   for(int i = 0; i < np && gNs < 25; i++) { string s = parts[i]; StringTrimLeft(s); StringTrimRight(s); if(s == "") continue; ArrayResize(gList, gNs + 1); gList[gNs++] = s; }
   if(gNs == 0) { Print("AT24 Market Heatmap: the watchlist is empty."); return INIT_PARAMETERS_INCORRECT; }
   ArrayResize(gRows, gNs); ArrayResize(gAlerted, gNs);
   for(int i = 0; i < gNs; i++) { gRows[i].ok = false; gAlerted[i] = 0; }
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
   if(rates_total < 2) return 0;
   Refresh();
   Draw();
   return rates_total;
  }
