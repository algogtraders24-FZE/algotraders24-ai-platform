//+------------------------------------------------------------------+
//| AT24 Rule Lab (MT5)                                              |
//| Six popular indicators (KAMA, FRAMA, HMA, TSI, Vortex, Squeeze)  |
//| as plain rules, measured on this symbol's own H1 history inside  |
//| each of the 5 AT24 Regime AI market states (average result, n,   |
//| luck test, optional stop), plus what followed the most similar   |
//| past situations (AT24 Analog Finder).                            |
//| A measurement of the past, not a forecast. Places no trades.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Rule Lab - KAMA, FRAMA, HMA, TSI, Vortex and Squeeze measured per market state on this symbol's own H1 history (average R, n, luck test, optional stop), with the AT24 Analog Finder block underneath."
#property description "A measurement of the past, not a forecast. Places no trades. Past results do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 12
#property indicator_plots   0

#include "AT24_RL_Core.mqh"
#include "AT24_AF_Core.mqh"

#resource "rl_logo56.bmp"

input group "=== Measured trade ==="
input int    InpHistBars   = 20000;   // Closed H1 bars used for the rule trades
input int    InpMaxBars    = 30000;   // H1 bars read from the chart (limits the first calculation)
input double InpStopAtr    = 2.0;     // Protective stop of the measured trades, in ATR(14) of the signal bar (0 = no stop)
input group "=== Analog Finder block ==="
input bool   InpShowAnalog = true;    // Show the analog block (what followed the most similar past situations)
input int    InpAfBars     = 12000;   // Closed H1 bars used by the analog search and its self-test
input group "=== Arrow and alert (bar close) ==="
input bool   InpDrawArrow  = true;    // Arrow on the last closed bar when a rule signals in a state where its own record is FIT
input bool   InpAlert      = false;   // Alert on that event
input bool   InpAlertPush  = false;   // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash   = true;    // Show dashboard
input bool   InpDashInTester = false; // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX      = 10;      // Dashboard X offset
input int    InpDashY      = 20;      // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[], B5[], B6[], B7[], B8[], B9[], B10[], B11[];
string PFX = "AT24RL_";
bool   gDash = false, gHave = false, gAfOk = false, gSelfOk = false;
int    gBaseX = 0, gBaseY = 0, gState = -1;
datetime gLastBar = 0, gAlertBar = 0;
AT24RL_Res gRes;
int    gSig[AT24RL_NR];
AT24AF_Stat gSt; AT24AF_Self gSelf;
double gAtr = 0.0, gPx = 0.0;
int    gSelfAt = -100000, gAfN = 0;

#define DASH_W 560
#define DASH_H 602

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

string ClsTxt(const int cls) { return cls == 1 ? "FIT" : (cls == -1 ? "AVOID" : (cls == 0 ? "NEUTRAL" : "TOO FEW")); }
color  ClsCol(const int cls) { return cls == 1 ? clrLimeGreen : (cls == -1 ? clrTomato : (cls == 0 ? clrSilver : clrSlateGray)); }
color  ClsBg(const int cls) { return cls == 1 ? C'28,98,56' : (cls == -1 ? C'112,38,38' : (cls == 0 ? C'48,58,80' : C'22,30,48')); }
string Sg(const double v, const int d = 2) { return (v >= 0.0 ? "+" : "") + DoubleToString(v, d); }
string Pr(const double v) { return DoubleToString(v, _Digits); }

//--- rectangles first (creation order = drawing order), labels after
void BuildFrame()
  {
   CalcBase();
   Rect("shadow", 6, 6, DASH_W, DASH_H, C'2,4,10', BORDER_FLAT, C'2,4,10');
   Rect("bg", 0, 0, DASH_W, DASH_H, C'14,26,48', BORDER_RAISED, C'110,130,175');
   Rect("hd", 4, 4, DASH_W - 8, 62, C'26,50,96', BORDER_RAISED, C'120,150,210');
   Rect("hd2", 4, 4, DASH_W - 8, 8, C'44,78,140', BORDER_FLAT, C'44,78,140');
   for(int r = 0; r < AT24RL_NR; r++) Rect("ch" + IntegerToString(r), 10 + (r % 3) * 184, 74 + (r / 3) * 66, 176, 60, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   Rect("gd", 10, 210, 540, 270, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   for(int s = 0; s < AT24RA_K; s++) Rect("gl" + IntegerToString(s), 0, 0, 1, 1, C'8,16,30', BORDER_FLAT, C'8,16,30');
   for(int r = 0; r < AT24RL_NR; r++)
      for(int s = 0; s < AT24RA_K; s++) Rect("cl" + IntegerToString(r * 5 + s), 0, 0, 1, 1, C'24,32,50', BORDER_RAISED, C'60,72,100');
   Rect("an", 10, 488, 540, 84, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::rl_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 8);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 7);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 72, 10, "AT24 RULE LAB", C'255,214,110', 14, true);
   MakeLabel("t2", 72, 38, "six popular indicators, measured per market state", C'170,190,225', 9);
   if(_Period != PERIOD_H1) { MakeLabel("w1", 18, 100, "Built for H1. Open this on an H1 chart.", clrGold, 11, true); return; }
   if(!gHave || gState < 0) { MakeLabel("w1", 18, 100, "Not enough history.", clrGold, 11, true); return; }
   ObjectDelete(0, PFX + "w1");
   int k = gState;
   MakeLabel("st0", 400, 10, "MARKET NOW", C'255,214,110', 8, true);
   MakeLabel("st1", 400, 24, AT24RA_Name(k), StateColor(k), 13, true);
   //--- six rule chips
   for(int r = 0; r < AT24RL_NR; r++)
     {
      AT24SF_Cell cc = gRes.c[r * AT24RA_K + k];
      int x = 10 + (r % 3) * 184, y = 74 + (r / 3) * 66; string id = IntegerToString(r);
      int sg = gSig[r];
      MakeLabel("rn" + id, x + 8, y + 4, AT24RL_RuleName(r), C'255,214,110', 8, true);
      MakeLabel("rs" + id, x + 80, y + 2, sg > 0 ? ShortToString(0x25B2) + " LONG" : (sg < 0 ? ShortToString(0x25BC) + " SHORT" : ShortToString(0x25CF) + " none"), sg > 0 ? clrLimeGreen : (sg < 0 ? clrTomato : clrSlateGray), 11, true, "Segoe UI Symbol");
      MakeLabel("rf" + id, x + 8, y + 24, "in " + AT24RA_Name(k) + ": " + ClsTxt(cc.cls), ClsCol(cc.cls), 8, cc.cls == 1);
      MakeLabel("rv" + id, x + 8, y + 40, cc.n > 0 ? StringFormat("%s R   n %d   p %.2f", Sg(cc.avg), cc.n, cc.p) : "no trades here", clrSilver, 8);
     }
   //--- grid
   MakeLabel("g0", 18, 215, "AVERAGE PER TRADE (ATR units) BY RULE AND STATE", C'255,214,110', 8, true);
   for(int s = 0; s < AT24RA_K; s++)
     {
      int x = 82 + s * 94;
      MakeLabel("gh" + IntegerToString(s), x + 6, 234, AT24RA_Name(s), StateColor(s), 8, true);
      Rect("gl" + IntegerToString(s), x - 3, 250, 90 + 6, AT24RL_NR * 34 + 2, s == k ? C'230,190,80' : C'8,16,30', BORDER_FLAT, s == k ? C'230,190,80' : C'8,16,30');
     }
   for(int r = 0; r < AT24RL_NR; r++)
     {
      int y = 252 + r * 34;
      MakeLabel("gr" + IntegerToString(r), 14, y + 8, AT24RL_RuleName(r), clrSilver, 8, true);
      for(int s = 0; s < AT24RA_K; s++)
        {
         AT24SF_Cell cc = gRes.c[r * AT24RA_K + s];
         int x = 82 + s * 94; string id = IntegerToString(r * 5 + s);
         Rect("cl" + id, x, y, 88, 31, ClsBg(cc.cls), BORDER_RAISED, Mix(ClsBg(cc.cls), clrWhite, 0.4));
         MakeLabel("cv" + id, x + 8, y + 1, cc.n > 0 ? Sg(cc.avg) : "-", cc.cls == 2 ? clrSlateGray : clrWhite, 10, true);
         MakeLabel("cn" + id, x + 8, y + 17, StringFormat("n %d  %s", cc.n, cc.cls == 1 ? "FIT" : (cc.cls == -1 ? "AVOID" : "")), ClsCol(cc.cls), 8);
        }
     }
   string stopTxt = InpStopAtr > 0.0 ? StringFormat("stop %.1f ATR (hit in %.0f %%)", InpStopAtr, gRes.trades > 0 ? 100.0 * gRes.stopped / gRes.trades : 0.0) : "NO stop";
   MakeLabel("g1", 18, 460, "24 h hold, " + stopTxt + ", spread cost.", clrSlateGray, 7);
   //--- analog block
   MakeLabel("a0", 18, 492, "ANALOGS OF THE LAST BAR (AT24 Analog Finder)", C'255,214,110', 8, true);
   if(InpShowAnalog && gAfOk)
     {
      MakeLabel("a1", 18, 508, StringFormat("%d similar past situations: next 24 h median %s ATR ~ %s", gSt.k, Sg(gSt.q50), Pr(gPx + gSt.q50 * gAtr)), clrWhite, 8, true);
      MakeLabel("a2", 18, 523, StringFormat("80 %% of them: %s to %s ATR (price %s - %s)", Sg(gSt.q10, 1), Sg(gSt.q90, 1), Pr(gPx + gSt.q10 * gAtr), Pr(gPx + gSt.q90 * gAtr)), clrSilver, 8);
      MakeLabel("a3", 18, 538, StringFormat("%.0f %% of them went up. Band held %.0f %% in the self-test.", gSt.shareUp * 100.0, gSelfOk ? gSelf.bandHeld * 100.0 : 0.0), clrSilver, 8);
      string vd = "direction: too few points"; color vc = clrSlateGray;
      if(gSelfOk) { if(gSelf.cls == 1) { vd = "direction worked on this symbol (p below 0.10)"; vc = clrLimeGreen; } else if(gSelf.cls == 0 || gSelf.cls == -1) { vd = "direction NOT RELIABLE on this symbol"; vc = clrGold; } }
      MakeLabel("a4", 18, 554, vd, vc, 8, true);
     }
   else
     {
      MakeLabel("a1", 18, 508, InpShowAnalog ? "analog block: not enough history" : "analog block is off", clrSlateGray, 8);
      MakeLabel("a2", 18, 523, " ", clrSlateGray, 8); MakeLabel("a3", 18, 538, " ", clrSlateGray, 8); MakeLabel("a4", 18, 554, " ", clrSlateGray, 8);
     }
   MakeLabel("n1", 12, 578, "A measurement of the past. With 30 cells some FIT are chance.", clrSlateGray, 7);
   MakeLabel("n2", 12, 589, "Past results do not predict future results.  algotraders24.ai", clrSlateGray, 7);
   ChartRedraw(0);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS); SetIndexBuffer(5, B5, INDICATOR_CALCULATIONS);
   SetIndexBuffer(6, B6, INDICATOR_CALCULATIONS); SetIndexBuffer(7, B7, INDICATOR_CALCULATIONS); SetIndexBuffer(8, B8, INDICATOR_CALCULATIONS);
   SetIndexBuffer(9, B9, INDICATOR_CALCULATIONS); SetIndexBuffer(10, B10, INDICATOR_CALCULATIONS); SetIndexBuffer(11, B11, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, false); ArraySetAsSeries(B1, false); ArraySetAsSeries(B2, false); ArraySetAsSeries(B3, false); ArraySetAsSeries(B4, false); ArraySetAsSeries(B5, false);
   ArraySetAsSeries(B6, false); ArraySetAsSeries(B7, false); ArraySetAsSeries(B8, false); ArraySetAsSeries(B9, false); ArraySetAsSeries(B10, false); ArraySetAsSeries(B11, false);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Rule Lab");
   if(InpHistBars < 3000 || InpHistBars > 200000 || InpMaxBars < 4000 || InpMaxBars > 200000 || InpAfBars < 3000 || InpAfBars > 100000 ||
      InpStopAtr < 0.0 || (InpStopAtr > 0.0 && InpStopAtr < 0.5) || InpStopAtr > 10.0)
     {
      Print("AT24 Rule Lab: history bars 3000-200000, bars read 4000-200000, analog bars 3000-100000, stop 0 or 0.5-10 ATR.");
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
   if(rates_total < 2500) return 0;
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
   AT24RL_Signals(nUse, h, l, c, sig);
   double cost = MathMax(0.0, SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID));
   int from = MathMax(AT24RL_FIRST, nUse - InpHistBars);
   AT24RL_Run(nUse, o, h, l, atr, ok, st, sig, cost, InpStopAtr, from, gRes);
   gState = st[nUse - 1]; gHave = (gState >= 0);
   for(int r = 0; r < AT24RL_NR; r++) gSig[r] = sig[(nUse - 1) * AT24RL_NR + r];
   gAtr = atr[nUse - 1]; gPx = c[nUse - 1];
   for(int i = 0; i < rates_total; i++) { B0[i] = EMPTY_VALUE; B1[i] = EMPTY_VALUE; B2[i] = EMPTY_VALUE; B3[i] = EMPTY_VALUE; B4[i] = EMPTY_VALUE; B5[i] = EMPTY_VALUE; B6[i] = EMPTY_VALUE; B7[i] = EMPTY_VALUE; B8[i] = EMPTY_VALUE; B9[i] = EMPTY_VALUE; B10[i] = EMPTY_VALUE; B11[i] = EMPTY_VALUE; }
   int lb = rates_total - 2;
   if(gHave)
     {
      B0[lb] = gSig[0]; B1[lb] = gSig[1]; B2[lb] = gSig[2]; B3[lb] = gSig[3]; B4[lb] = gSig[4]; B5[lb] = gSig[5];
      int cl[AT24RL_NR];
      for(int r = 0; r < AT24RL_NR; r++) { int cc = gRes.c[r * AT24RA_K + gState].cls; cl[r] = (cc == 1) ? 1 : (cc == -1 ? -1 : 0); }
      B6[lb] = cl[0]; B7[lb] = cl[1]; B8[lb] = cl[2]; B9[lb] = cl[3]; B10[lb] = cl[4]; B11[lb] = cl[5];
      //--- live event: a rule signals on the last closed bar while its own record in this state is FIT
      if(gAlertBar != time[lb])
        {
         for(int r = 0; r < AT24RL_NR; r++)
           {
            if(gSig[r] == 0 || gRes.c[r * AT24RA_K + gState].cls != 1) continue;
            gAlertBar = time[lb];
            if(InpDrawArrow)
              {
               string an = PFX + "ar" + IntegerToString(r) + "_" + IntegerToString((long)time[lb]);
               double offp = MathMax(atr[nUse - 1] * 0.6, _Point * 10);
               ObjectCreate(0, an, gSig[r] > 0 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL, 0, time[lb], gSig[r] > 0 ? low[lb] - offp : high[lb] + offp);
               ObjectSetInteger(0, an, OBJPROP_COLOR, gSig[r] > 0 ? clrLimeGreen : clrTomato);
               ObjectSetInteger(0, an, OBJPROP_WIDTH, 4);
               ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);
               ObjectSetInteger(0, an, OBJPROP_HIDDEN, true);
               ObjectSetString(0, an, OBJPROP_TOOLTIP, StringFormat("AT24 Rule Lab: %s %s in %s (own record FIT)", AT24RL_RuleName(r), gSig[r] > 0 ? "long" : "short", AT24RA_Name(gState)));
              }
            if(InpAlert)
              {
               string msg = StringFormat("AT24 Rule Lab %s: %s %s in %s (own record FIT %s R, n %d)", _Symbol, AT24RL_RuleName(r), gSig[r] > 0 ? "long" : "short", AT24RA_Name(gState), Sg(gRes.c[r * AT24RA_K + gState].avg), gRes.c[r * AT24RA_K + gState].n);
               Alert(msg);
               if(InpAlertPush) SendNotification(msg);
              }
           }
        }
     }
   //--- analog block (search every bar, self-test every 24 bars)
   gAfOk = false;
   if(InpShowAnalog)
     {
      int nA = MathMin(nUse, InpAfBars), offA = nUse - nA;
      double ha[], la[], ca[]; ArrayResize(ha, nA); ArrayResize(la, nA); ArrayResize(ca, nA);
      for(int i = 0; i < nA; i++) { ha[i] = h[offA + i]; la[i] = l[offA + i]; ca[i] = c[offA + i]; }
      double f[], at2[], y[]; bool oka[], yoka[];
      AT24AF_Series(nA, ha, la, ca, f, at2, y, oka, yoka);
      double mu[], sd[]; int sEnd;
      if(AT24AF_Scale(nA, f, oka, yoka, mu, sd, sEnd) && oka[nA - 1])
        {
         AT24AF_Search(nA - 1, nA - 1 - AT24AF_FWD, f, oka, yoka, y, mu, sd, gSt);
         gAfOk = true; gAfN = nA; gAtr = at2[nA - 1]; gPx = ca[nA - 1];
         if(!gSelfOk || rates_total - gSelfAt >= 24) { AT24AF_SelfTest(nA, f, oka, yoka, y, mu, sd, sEnd, gSelf); gSelfOk = gSelf.ok; gSelfAt = rates_total; }
        }
     }
   Draw();
   return rates_total;
  }
