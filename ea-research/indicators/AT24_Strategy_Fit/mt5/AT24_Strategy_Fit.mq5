//+------------------------------------------------------------------+
//| AT24 Strategy Fit (MT5)                                          |
//| Three plain rules (trend, breakout, reversion) and how each one  |
//| performed in each of the 5 AT24 Regime AI market states, on this |
//| symbol's own H1 history, with n and a luck test. It marks which  |
//| rule fits the state the market is in now.                        |
//| A measurement of the past, not a forecast. Places no trades.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Strategy Fit - trend, breakout and reversion rules measured per Regime AI market state on this symbol's own H1 history (average R, n, luck test) and which rule fits the current state."
#property description "A measurement of the past, not a forecast. Places no trades. Past results do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 6
#property indicator_plots   0

#include "AT24_SF_Core.mqh"

#resource "sf_logo56.bmp"

input group "=== History ==="
input int    InpHistBars   = 20000;   // Closed H1 bars used for the trades
input int    InpMaxBars    = 30000;   // H1 bars read from the chart (limits the first calculation)
input group "=== Alert and arrow (bar close) ==="
input bool   InpDrawArrow  = true;    // Draw an arrow when a rule signals in a state where its own record is FIT
input bool   InpAlert      = false;   // Alert on that event
input bool   InpAlertPush  = false;   // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash   = true;    // Show dashboard
input bool   InpDashInTester = false; // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX      = 10;      // Dashboard X offset
input int    InpDashY      = 20;      // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[], B5[];
string PFX = "AT24SF_";
bool   gDash = false, gHave = false;
int    gBaseX = 0, gBaseY = 0;
datetime gLastBar = 0, gAlertBar = 0;
AT24SF_Res gRes;
int    gState = -1;
int    gSigNow[3];
double gCost = 0.0;

#define DASH_W 560
#define DASH_H 396

color StateColor(const int s)
  {
   switch(s)
     {
      case 0: return C'120,130,145';
      case 1: return C'230,140,60';
      case 2: return C'60,190,110';
      case 3: return C'80,160,230';
      case 4: return C'180,120,220';
     }
   return clrSlateGray;
  }

color Mix(const color a, const color b, const double t)
  {
   int ar = a & 0xFF, ag = (a >> 8) & 0xFF, ab = (a >> 16) & 0xFF;
   int br = b & 0xFF, bgc = (b >> 8) & 0xFF, bb = (b >> 16) & 0xFF;
   int r = (int)(ar + (br - ar) * t), g = (int)(ag + (bgc - ag) * t), u = (int)(ab + (bb - ab) * t);
   return (color)(r | (g << 8) | (u << 16));
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

void MakeLabel(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false, const string font = "")
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetString(0, n, OBJPROP_FONT, font != "" ? font : (bold ? "Segoe UI Black" : "Segoe UI"));
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, n, OBJPROP_TEXT, txt == "" ? " " : txt);
  }

void Rect(const string name, const int x, const int y, const int w, const int h, const color bg, const ENUM_BORDER_TYPE bt, const color border)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, MathMax(h, 1));
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, bt);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

//--- rectangles first (creation order = drawing order), labels after
void BuildFrame()
  {
   CalcBase();
   Rect("shadow", 6, 6, DASH_W, DASH_H, C'2,4,10', BORDER_FLAT, C'2,4,10');
   Rect("bg", 0, 0, DASH_W, DASH_H, C'14,26,48', BORDER_RAISED, C'110,130,175');
   Rect("hd", 4, 4, DASH_W - 8, 62, C'26,50,96', BORDER_RAISED, C'120,150,210');
   Rect("hd2", 4, 4, DASH_W - 8, 8, C'44,78,140', BORDER_FLAT, C'44,78,140');
   for(int r = 0; r < AT24SF_NR; r++) Rect("nw" + IntegerToString(r), 10 + r * 184, 74, 176, 100, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   Rect("gd", 10, 182, 540, 178, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   for(int s = 0; s < AT24RA_K; s++) Rect("gl" + IntegerToString(s), 0, 0, 1, 1, C'8,16,30', BORDER_FLAT, C'8,16,30');
   for(int r = 0; r < AT24SF_NR; r++)
      for(int s = 0; s < AT24RA_K; s++) Rect("cl" + IntegerToString(r * 5 + s), 0, 0, 1, 1, C'24,32,50', BORDER_RAISED, C'60,72,100');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::sf_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 8);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 7);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string ClsTxt(const int cls)
  {
   if(cls == 1) return "FIT";
   if(cls == -1) return "AVOID";
   if(cls == 0) return "NEUTRAL";
   return "TOO FEW";
  }
color ClsCol(const int cls)
  {
   if(cls == 1) return clrLimeGreen;
   if(cls == -1) return clrTomato;
   if(cls == 0) return clrSilver;
   return clrSlateGray;
  }
color ClsBg(const int cls)
  {
   if(cls == 1) return C'28,98,56';
   if(cls == -1) return C'112,38,38';
   if(cls == 0) return C'48,58,80';
   return C'22,30,48';
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 72, 10, "AT24 STRATEGY FIT", C'255,214,110', 14, true);
   MakeLabel("t2", 72, 38, "which rule fits this market state", C'170,190,225', 9);
   if(_Period != PERIOD_H1)
     {
      MakeLabel("w1", 18, 100, "Trained on H1. Open this on an H1 chart.", clrGold, 11, true);
      return;
     }
   if(!gHave || gState < 0)
     {
      MakeLabel("w1", 18, 100, "Not enough history.", clrGold, 11, true);
      return;
     }
   ObjectDelete(0, PFX + "w1");
   int k = gState;
   MakeLabel("st0", 330, 10, "MARKET NOW", C'255,214,110', 8, true);
   MakeLabel("st1", 330, 24, AT24RA_Name(k), StateColor(k), 13, true);
   //--- three rule cards: signal on the last closed bar and the rule's own record in this state
   for(int r = 0; r < AT24SF_NR; r++)
     {
      AT24SF_Cell cc = gRes.c[r * AT24RA_K + k];
      int x = 10 + r * 184; string id = IntegerToString(r);
      MakeLabel("rn" + id, x + 8, 78, AT24SF_RuleName(r), C'255,214,110', 8, true);
      int sg = gSigNow[r];
      string sgt = sg > 0 ? ShortToString(0x25B2) + " LONG" : (sg < 0 ? ShortToString(0x25BC) + " SHORT" : ShortToString(0x25CF) + " none");
      MakeLabel("rs" + id, x + 8, 94, sgt, sg > 0 ? clrLimeGreen : (sg < 0 ? clrTomato : clrSlateGray), 14, true, "Segoe UI Symbol");
      MakeLabel("rf" + id, x + 8, 128, "in " + AT24RA_Name(k) + ": " + ClsTxt(cc.cls), ClsCol(cc.cls), 9, cc.cls == 1);
      MakeLabel("rv" + id, x + 8, 146, cc.n > 0 ? StringFormat("%+.2f R   n %d   p %.2f", cc.avg, cc.n, cc.p) : "no trades here", clrSilver, 8);
     }
   //--- grid
   MakeLabel("g0", 18, 187, "AVERAGE R PER TRADE (24 h hold, ATR units) BY RULE AND STATE", C'255,214,110', 8, true);
   for(int s = 0; s < AT24RA_K; s++)
     {
      int x = 82 + s * 94;
      MakeLabel("gh" + IntegerToString(s), x + 6, 206, AT24RA_Name(s), StateColor(s), 8, true);
      Rect("gl" + IntegerToString(s), x - 3, 222, 90 + 6, 3 * 40 + 2, s == k ? C'230,190,80' : C'8,16,30', BORDER_FLAT, s == k ? C'230,190,80' : C'8,16,30');
     }
   for(int r = 0; r < AT24SF_NR; r++)
     {
      int y = 224 + r * 40;
      MakeLabel("gr" + IntegerToString(r), 14, y + 10, AT24SF_RuleName(r), clrSilver, 8, true);
      for(int s = 0; s < AT24RA_K; s++)
        {
         AT24SF_Cell cc = gRes.c[r * AT24RA_K + s];
         int x = 82 + s * 94; string id = IntegerToString(r * 5 + s);
         Rect("cl" + id, x, y, 88, 36, ClsBg(cc.cls), BORDER_RAISED, Mix(ClsBg(cc.cls), clrWhite, 0.4));
         MakeLabel("cv" + id, x + 8, y + 3, cc.n > 0 ? StringFormat("%+.2f", cc.avg) : "-", cc.cls == 2 ? clrSlateGray : clrWhite, 11, true);
         MakeLabel("cn" + id, x + 8, y + 21, StringFormat("n %d  %s", cc.n, cc.cls == 1 ? "FIT" : (cc.cls == -1 ? "AVOID" : "")), ClsCol(cc.cls), 8);
        }
     }
   MakeLabel("n1", 12, 366, "FIT = average above 0 and luck test p below 0.10 (n 30+).", clrSlateGray, 7);
   MakeLabel("n2", 12, 377, "Cost = current spread. Measured on past bars, no forecast.", clrSlateGray, 7);
   MakeLabel("n3", 12, 387, "Past results do not predict future results.  algotraders24.ai", clrSlateGray, 7);
   ChartRedraw(0);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS); SetIndexBuffer(5, B5, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, false); ArraySetAsSeries(B1, false); ArraySetAsSeries(B2, false); ArraySetAsSeries(B3, false); ArraySetAsSeries(B4, false); ArraySetAsSeries(B5, false);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Strategy Fit");
   if(InpHistBars < 3000 || InpHistBars > 200000 || InpMaxBars < 4000 || InpMaxBars > 200000)
     {
      Print("AT24 Strategy Fit: history bars 3000-200000, bars read 4000-200000.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) Draw();
  }

void OnDeinit(const int reason) { ObjectsDeleteAll(0, PFX); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 700) return 0;
   datetime curBar = time[rates_total - 1];
   if(prev_calculated > 0 && curBar == gLastBar) return rates_total;
   gLastBar = curBar;
   int nUse = MathMin(rates_total - 1, InpMaxBars);
   int off = (rates_total - 1) - nUse;
   double o[], h[], l[], c[]; ArrayResize(o, nUse); ArrayResize(h, nUse); ArrayResize(l, nUse); ArrayResize(c, nUse);
   for(int i = 0; i < nUse; i++) { o[i] = open[off + i]; h[i] = high[off + i]; l[i] = low[off + i]; c[i] = close[off + i]; }
   double atr[], er[], lv[], sl[], rg[]; bool ok[]; int st[], sig[];
   AT24RA_Features(nUse, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(nUse, er, lv, sl, rg, ok, st);
   AT24SF_Signals(nUse, h, l, c, sig);
   gCost = MathMax(0.0, SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID));
   int from = MathMax(AT24SF_FIRST, nUse - InpHistBars);
   AT24SF_Run(nUse, o, atr, ok, st, sig, gCost, from, gRes);
   gState = st[nUse - 1];
   for(int r = 0; r < AT24SF_NR; r++) gSigNow[r] = sig[(nUse - 1) * AT24SF_NR + r];
   gHave = (gState >= 0);
   //--- buffers of the last closed bar
   for(int i = 0; i < rates_total; i++) { B0[i] = EMPTY_VALUE; B1[i] = EMPTY_VALUE; B2[i] = EMPTY_VALUE; B3[i] = EMPTY_VALUE; B4[i] = EMPTY_VALUE; B5[i] = EMPTY_VALUE; }
   int lb = rates_total - 2;
   if(gHave)
     {
      B0[lb] = gSigNow[0]; B1[lb] = gSigNow[1]; B2[lb] = gSigNow[2];
      int cl[3];
      for(int r = 0; r < 3; r++) { int cc = gRes.c[r * AT24RA_K + gState].cls; cl[r] = (cc == 1) ? 1 : (cc == -1 ? -1 : 0); }
      B3[lb] = cl[0]; B4[lb] = cl[1]; B5[lb] = cl[2];
      //--- live event: a rule signals on the last closed bar while its own record in this state is FIT
      if(gAlertBar != time[lb])
        {
         for(int r = 0; r < AT24SF_NR; r++)
           {
            if(gSigNow[r] == 0 || gRes.c[r * AT24RA_K + gState].cls != 1) continue;
            gAlertBar = time[lb];
            if(InpDrawArrow)
              {
               string an = PFX + "ar" + IntegerToString(r) + "_" + IntegerToString((long)time[lb]);
               double offp = MathMax(atr[nUse - 1] * 0.6, _Point * 10);
               double px = gSigNow[r] > 0 ? low[lb] - offp : high[lb] + offp;
               ObjectCreate(0, an, gSigNow[r] > 0 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, time[lb], px);
               ObjectSetInteger(0, an, OBJPROP_COLOR, gSigNow[r] > 0 ? clrLimeGreen : clrTomato);
               ObjectSetInteger(0, an, OBJPROP_WIDTH, 4);
               ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);
               ObjectSetInteger(0, an, OBJPROP_HIDDEN, true);
               ObjectSetString(0, an, OBJPROP_TOOLTIP, StringFormat("AT24 Strategy Fit: %s %s in %s (own record FIT)", AT24SF_RuleName(r), gSigNow[r] > 0 ? "long" : "short", AT24RA_Name(gState)));
              }
            if(InpAlert)
              {
               string msg = StringFormat("AT24 Strategy Fit %s: %s %s in %s (own record FIT, %+.2f R, n %d)", _Symbol, AT24SF_RuleName(r), gSigNow[r] > 0 ? "long" : "short", AT24RA_Name(gState), gRes.c[r * AT24RA_K + gState].avg, gRes.c[r * AT24RA_K + gState].n);
              Alert(msg);
               if(InpAlertPush) SendNotification(msg);
              }
           }
        }
     }
   Draw();
   return rates_total;
  }
