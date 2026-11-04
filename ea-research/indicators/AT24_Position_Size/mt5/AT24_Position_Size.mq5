//+------------------------------------------------------------------+
//| AT24 Position Size (MT5)                                         |
//| Lot size from the money you are willing to risk and the stop     |
//| distance - with the symbol's real tick value, volume step and    |
//| limits. Checked against the platform's own loss calculation.     |
//| Calculator. Not a signal. Not financial advice.                  |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Position Size - lots from risk % and stop distance, margin, SL/TP lines on the chart."
#property description "Calculator only. It never places or modifies trades."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_PS_Core.mqh"

#resource "ps_logo56.bmp"

enum ENUM_AT24PS_SL
  {
   PS_SL_DISTANCE = 0,   // Fixed distance in price units (e.g. 10.0 = 10 USD on gold)
   PS_SL_ATR      = 1    // ATR multiple (ATR of closed bars on this chart)
  };

input group "=== Risk ==="
input double InpRiskPct       = 1.0;    // Risk per trade, % of account
input double InpAccountSize   = 0.0;    // Account size (0 = live balance)
input double InpDemoBalance   = 10000.0;// Balance used when no account is connected
input double InpMaxRiskPct    = 2.0;    // Warn when the risk exceeds this %
input group "=== Stop distance ==="
input ENUM_AT24PS_SL InpSlMode = PS_SL_DISTANCE; // How the stop distance is set
input double InpSlDistance    = 10.0;   // Stop distance in price units
input int    InpAtrLen        = 14;     // ATR length
input double InpAtrMult       = 1.5;    // Stop = ATR x this
input double InpR1            = 1.0;    // First target in R (stop distances)
input double InpR2            = 2.0;    // Second target in R
input group "=== Look ==="
input bool   InpShowLines     = true;   // Draw stop / target lines from the last close
input color  InpLongColor     = clrLimeGreen;   // Long levels
input color  InpShortColor    = clrTomato;      // Short levels
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24PS_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
double gAtr = 0.0;
int    gLastTotal = 0;
double gPrice = 0.0;

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
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ps_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }
string Money(const double v) { return StringFormat("%s %s", DoubleToString(v, 2), AccountInfoString(ACCOUNT_CURRENCY)); }

double Balance(bool &live)
  {
   live = false;
   if(InpAccountSize > 0.0) return InpAccountSize;
   double b = AccountInfoDouble(ACCOUNT_BALANCE);
   if(AccountInfoInteger(ACCOUNT_LOGIN) != 0 && b > 0.0) { live = true; return b; }
   return InpDemoBalance;
  }

void Line(const string nm, const datetime t1, const datetime t2, const double p, const color col, const int style, const string txt)
  {
   ObjectCreate(0, nm, OBJ_TREND, 0, t1, p, t2, p);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, style);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, nm, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, nm, OBJPROP_HIDDEN, true);
   string tx = nm + "t";
   ObjectCreate(0, tx, OBJ_TEXT, 0, t2, p);
   ObjectSetString(0, tx, OBJPROP_TEXT, txt + "  " + DoubleToString(p, Dg()));
   ObjectSetInteger(0, tx, OBJPROP_COLOR, col);
   ObjectSetInteger(0, tx, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, tx, OBJPROP_ANCHOR, ANCHOR_RIGHT_LOWER);
   ObjectSetInteger(0, tx, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, tx, OBJPROP_HIDDEN, true);
  }

void Recalc(const datetime &time[], const int rates_total)
  {
   bool live;
   double bal = Balance(live);
   double risk = bal * InpRiskPct / 100.0;
   double sl = (InpSlMode == PS_SL_ATR) ? gAtr * InpAtrMult : InpSlDistance;
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   //--- no account connected: the platform gives no tick value. Estimate it as tick size x contract size (right when the
   //--- profit currency is your account currency, e.g. gold in USD) and say so on the panel.
   bool estimated = false;
   if(tv <= 0.0) { tv = ts * SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE); estimated = true; }
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), vst = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   AT24PS_Result r;
   AT24PS_Size(risk, sl, ts, tv, vmin, vmax, vst, r);
   B0[0] = r.lots; B1[0] = risk; B2[0] = sl; B3[0] = r.riskAtLots; B4[0] = r.lossPerLot;
   if(InpShowLines)
     {
      ObjectsDeleteAll(0, PFX + "ln");
      if(sl > 0.0)
        {
         datetime t1 = time[rates_total - 1] - PeriodSeconds() * 10, t2 = time[rates_total - 1] + PeriodSeconds() * 14;
         //--- one ladder of levels above and below the last close, in stop distances (1x, R1, R2; duplicates merged)
         double ks[3] = {1.0, InpR1, InpR2};
         int shown = 0;
         for(int a = 0; a < 3; a++)
           {
            bool dup = false;
            for(int b = 0; b < a; b++) if(MathAbs(ks[a] - ks[b]) < 1e-9) dup = true;
            if(dup) continue;
            string tag = (MathAbs(ks[a] - 1.0) < 1e-9) ? "1.0 x stop" : StringFormat("%.1f x stop", ks[a]);
            Line(PFX + "lnu" + IntegerToString(shown), t1, t2, gPrice + sl * ks[a], InpLongColor, STYLE_DASH, "+" + tag + " (long target / short stop)");
            Line(PFX + "lnd" + IntegerToString(shown), t1, t2, gPrice - sl * ks[a], InpShortColor, STYLE_DASH, "-" + tag + " (long stop / short target)");
            shown++;
           }
        }
     }
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 POSITION SIZE", C'230,190,80', 10, true);
   if(r.lots > 0.0) MakeLabel("t2", 70, 26, StringFormat("%.2f LOTS", r.lots), clrWhite, 12, true);
   else MakeLabel("t2", 70, 26, r.tooSmall ? "MIN LOT RISKS TOO MUCH" : "CHECK INPUTS", clrTomato, 11, true);
   double rp = bal > 0.0 ? 100.0 * r.riskAtLots / bal : 0.0;
   MakeLabel("l1", 10, 66, StringFormat("Account %s%s   risk %.2f%% = %s", Money(bal), live ? "" : " (demo number)", InpRiskPct, Money(risk)), clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("Stop %s price units = %.0f points   (%s)", DoubleToString(sl, Dg()), _Point > 0 ? sl / _Point : 0.0, InpSlMode == PS_SL_ATR ? StringFormat("ATR %s x %.1f", DoubleToString(gAtr, Dg()), InpAtrMult) : "fixed"), clrWhite, 9);
   MakeLabel("l3", 10, 98, StringFormat("Loss per 1.00 lot at the stop: %s%s", Money(r.lossPerLot), estimated ? "  (estimated)" : ""), estimated ? clrOrange : clrWhite, 9);
   MakeLabel("l4", 10, 114, StringFormat("Actual risk at %.2f lots: %s  (%.2f%%)", r.lots, Money(r.riskAtLots), rp), r.riskAtLots > risk + 1e-9 ? clrTomato : clrWhite, 9);
   double margin = 0.0;
   if(r.lots > 0.0 && !OrderCalcMargin(ORDER_TYPE_BUY, _Symbol, r.lots, gPrice, margin)) margin = 0.0;
   MakeLabel("l5", 10, 130, margin > 0.0 ? StringFormat("Margin needed: %s", Money(margin)) : "Margin needed: not available without an account", margin > 0.0 ? clrWhite : clrSlateGray, 9);
   MakeLabel("l6", 10, 146, StringFormat("Targets: %.1fR = %s   %.1fR = %s", InpR1, Money(r.riskAtLots * InpR1), InpR2, Money(r.riskAtLots * InpR2)), clrSilver, 9);
   string warn = r.capped ? "Capped by the symbol's maximum volume." : (InpRiskPct > InpMaxRiskPct ? StringFormat("Risk %.1f%% is above your %.1f%% limit.", InpRiskPct, InpMaxRiskPct) : (r.lots > 0.0 && rp < InpRiskPct * 0.5 ? "Rounded down a lot: real risk is well below target." : ""));
   MakeLabel("w1", 10, 170, warn == "" ? " " : warn, clrOrange, 9, true);
   MakeLabel("n1", 10, 196, "Lots are rounded DOWN to the step, never up.", clrSlateGray, 8);
   MakeLabel("n2", 10, 210, "Spread, slippage and gaps can make a real loss larger.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Calculator. It never places trades. Not financial advice.", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "Check lot size in your platform before trading. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Position Size");
   if(InpRiskPct <= 0.0 || InpRiskPct > 100.0 || InpSlDistance <= 0.0 || InpAtrLen < 2 || InpAtrMult <= 0.0 || InpR1 <= 0.0 || InpR2 <= 0.0 || InpDemoBalance <= 0.0)
     {
      Print("AT24 Position Size: risk % 0-100, stop distance > 0, ATR length >= 2, multiples > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { ObjectsDeleteAll(0, PFX); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 50) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- ATR from closed bars (last 600) - never includes the forming bar
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, 600.0);
      int base = total - nb;
      double h[], l[], c[]; ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; }
      gAtr = AT24PS_Atr(nb, h, l, c, InpAtrLen);
      gPrice = close[rates_total - 2];
     }
   Recalc(time, rates_total);
   return rates_total;
  }
