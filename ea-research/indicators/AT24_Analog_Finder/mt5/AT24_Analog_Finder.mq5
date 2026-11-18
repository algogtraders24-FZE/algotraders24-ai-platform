//+------------------------------------------------------------------+
//| AT24 Analog Finder (MT5)                                         |
//| Finds the past H1 situations of this symbol that look most like  |
//| the last closed bar (30 analogs, at least 24 bars apart) and     |
//| shows what happened in the 24 hours after each of them, in ATR   |
//| units and in price, with a self-test of how reliable this kind   |
//| of look-up has been on this symbol's own history.                |
//| A look-up of the past, not a forecast. No signals. No trades.    |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Analog Finder - the 30 most similar past H1 situations of this symbol and what followed them over the next 24 hours (median, 80 % band, share up, histogram), with a self-test on the symbol's own history that says whether direction was reliable."
#property description "A look-up of the past, not a forecast. Places no trades. Past results do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 6
#property indicator_plots   0

#include "AT24_AF_Core.mqh"

#resource "af_logo56.bmp"

input group "=== History ==="
input int    InpBars       = 12000;  // Closed H1 bars used (search and self-test)
input group "=== Chart ==="
input bool   InpMarkers    = true;   // Mark the analog bars on the chart (green = the next 24 h went up, red = down)
input group "=== Dashboard ==="
input bool   InpShowDash   = true;   // Show dashboard
input bool   InpDashInTester = false;// Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX      = 10;     // Dashboard X offset
input int    InpDashY      = 20;     // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[], B5[];
string PFX = "AT24AF_";
bool   gDash = false, gHave = false, gSelfOk = false;
int    gBaseX = 0, gBaseY = 0;
datetime gLastBar = 0;
AT24AF_Stat gSt;
AT24AF_Self gSelf;
double gAtr = 0.0, gPx = 0.0, gVal[AT24AF_MAXK];
int    gN = 0, gSelfAt = -100000;
int    gHist[10];
double gHistLo = 0.0, gHistStep = 1.0;

#define DASH_W 560
#define DASH_H 410
#define NBIN 10

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

void BuildFrame()
  {
   CalcBase();
   Rect("shadow", 6, 6, DASH_W, DASH_H, C'2,4,10', BORDER_FLAT, C'2,4,10');
   Rect("bg", 0, 0, DASH_W, DASH_H, C'14,26,48', BORDER_RAISED, C'110,130,175');
   Rect("hd", 4, 4, DASH_W - 8, 62, C'26,50,96', BORDER_RAISED, C'120,150,210');
   Rect("hd2", 4, 4, DASH_W - 8, 8, C'44,78,140', BORDER_FLAT, C'44,78,140');
   Rect("cL", 10, 74, 330, 104, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   Rect("cR", 350, 74, 200, 104, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   Rect("hs", 10, 186, 540, 118, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   for(int b = 0; b < NBIN; b++) Rect("hb" + IntegerToString(b), 0, 0, 1, 1, C'80,160,230', BORDER_RAISED, C'160,200,240');
   Rect("zero", 0, 0, 1, 1, C'230,190,80', BORDER_FLAT, C'230,190,80');
   Rect("st", 10, 312, 540, 70, C'8,16,30', BORDER_SUNKEN, C'90,105,140');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::af_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 8);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 7);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string Pr(const double v) { return DoubleToString(v, _Digits); }
string Sg(const double v, const int d = 2) { return (v >= 0.0 ? "+" : "") + DoubleToString(v, d); }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 72, 10, "AT24 ANALOG FINDER", C'255,214,110', 14, true);
   MakeLabel("t2", 72, 38, "what followed the most similar past situations", C'170,190,225', 9);
   if(_Period != PERIOD_H1) { MakeLabel("w1", 18, 100, "Built for H1. Open this on an H1 chart.", clrGold, 11, true); return; }
   if(!gHave) { MakeLabel("w1", 18, 100, "Not enough history (needs about 2000 H1 bars).", clrGold, 11, true); return; }
   ObjectDelete(0, PFX + "w1");
   //--- left card: median and band
   MakeLabel("l1", 18, 78, StringFormat("%d ANALOGS", gSt.k), C'255,214,110', 8, true);
   MakeLabel("l2", 100, 78, StringFormat("of %d bars, 24+ apart, distance %.1f", gN, gSt.meanDist), clrSlateGray, 8);
   MakeLabel("l3", 18, 94, "NEXT 24 H, median", C'170,190,225', 8);
   MakeLabel("l4", 18, 108, StringFormat("%s ATR  ~ %s", Sg(gSt.q50), Pr(gPx + gSt.q50 * gAtr)), clrWhite, 15, true);
   MakeLabel("l5", 18, 140, StringFormat("80 %% of analogs: %s to %s ATR", Sg(gSt.q10, 1), Sg(gSt.q90, 1)), clrSilver, 8);
   MakeLabel("l6", 18, 156, StringFormat("price %s - %s", Pr(gPx + gSt.q10 * gAtr), Pr(gPx + gSt.q90 * gAtr)), clrSilver, 8, true);
   //--- right card: share up
   MakeLabel("r1", 358, 78, "SHARE THAT WENT UP", C'255,214,110', 8, true);
   color uc = gSt.shareUp >= 0.6 ? clrLimeGreen : (gSt.shareUp <= 0.4 ? clrTomato : clrSilver);
   MakeLabel("r2", 358, 94, StringFormat("%.0f %%", gSt.shareUp * 100.0), uc, 24, true);
   MakeLabel("r3", 358, 140, StringFormat("%d of %d analogs", (int)MathRound(gSt.shareUp * gSt.k), gSt.k), clrSilver, 8);
   MakeLabel("r4", 358, 156, "1 ATR = " + Pr(gAtr), clrSlateGray, 8);
   //--- histogram of the analog outcomes (10 bins)
   MakeLabel("g0", 18, 190, "OUTCOMES OF THE ANALOGS, next 24 h in ATR (marker = 0)", C'255,214,110', 8, true);
   int maxc = 1; for(int b = 0; b < NBIN; b++) if(gHist[b] > maxc) maxc = gHist[b];
   int base = 186 + 118 - 22; int x0 = 26, bw = 48;
   for(int b = 0; b < NBIN; b++)
     {
      double lo = gHistLo + b * gHistStep, hi = lo + gHistStep;
      int hh = (gHist[b] > 0) ? (int)(8 + 60.0 * gHist[b] / maxc) : 2;
      color bc = (hi <= 0.0) ? C'210,90,80' : ((lo >= 0.0) ? C'60,190,110' : C'200,200,120');
      Rect("hb" + IntegerToString(b), x0 + b * (bw + 2), base - hh, bw, hh, gHist[b] > 0 ? bc : C'40,50,70', BORDER_RAISED, Mix(bc, clrWhite, 0.45));
      MakeLabel("hc" + IntegerToString(b), x0 + b * (bw + 2) + 16, base + 2, IntegerToString(gHist[b]), clrSilver, 8);
      MakeLabel("hl" + IntegerToString(b), x0 + b * (bw + 2) + 2, base + 12, DoubleToString(lo, 1), clrSlateGray, 7);
     }
   if(gHistLo < 0.0 && gHistLo + NBIN * gHistStep > 0.0)
      Rect("zero", x0 + (int)((0.0 - gHistLo) / gHistStep * (bw + 2)) - 1, base - 70, 2, 70, C'230,190,80', BORDER_FLAT, C'230,190,80');
   else Rect("zero", 0, 0, 1, 1, C'8,16,30', BORDER_FLAT, C'8,16,30');
   //--- self-test
   MakeLabel("s0", 18, 316, "SELF-TEST ON THIS SYMBOL'S OWN HISTORY (later 40 %)", C'255,214,110', 8, true);
   if(gSelfOk && gSelf.ok)
     {
      MakeLabel("s1", 18, 332, StringFormat("80 %% band held %.0f %% of %d points   always long %s ATR", gSelf.bandHeld * 100.0, gSelf.nTest, Sg(gSelf.alwaysLong)), clrSilver, 8);
      string verdict; color vc;
      if(gSelf.cls == 2) { verdict = "direction: too few points to say"; vc = clrSlateGray; }
      else if(gSelf.cls == 1) { verdict = "direction worked here (average above 0, p below 0.10)"; vc = clrLimeGreen; }
      else { verdict = "direction NOT RELIABLE here"; vc = clrGold; }
      MakeLabel("s2", 18, 348, StringFormat("when analogs agreed: hit %.0f %%, avg %s ATR, n %d, p %.2f", gSelf.hit * 100.0, Sg(gSelf.avgR), gSelf.nSel, gSelf.p), clrSilver, 8);
      MakeLabel("s3", 18, 364, verdict, vc, 9, true);
     }
   else
     {
      MakeLabel("s1", 18, 332, "self-test needs more history", clrSlateGray, 8);
      MakeLabel("s2", 18, 348, " ", clrSlateGray, 8);
      MakeLabel("s3", 18, 364, " ", clrSlateGray, 8);
     }
   MakeLabel("n1", 12, 388, "A look-up of the past, not a forecast. Similar is not the same.", clrSlateGray, 7);
   MakeLabel("n2", 12, 398, "Past results do not predict future results. algotraders24.ai", clrSlateGray, 7);
   ChartRedraw(0);
  }

void DelMarkers() { ObjectsDeleteAll(0, PFX + "mk"); }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS); SetIndexBuffer(5, B5, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, false); ArraySetAsSeries(B1, false); ArraySetAsSeries(B2, false); ArraySetAsSeries(B3, false); ArraySetAsSeries(B4, false); ArraySetAsSeries(B5, false);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Analog Finder");
   if(InpBars < 3000 || InpBars > 100000)
     {
      Print("AT24 Analog Finder: bars 3000-100000.");
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
   int nUse = MathMin(rates_total - 1, InpBars);
   int off = (rates_total - 1) - nUse;
   double h[], l[], c[]; ArrayResize(h, nUse); ArrayResize(l, nUse); ArrayResize(c, nUse);
   for(int i = 0; i < nUse; i++) { h[i] = high[off + i]; l[i] = low[off + i]; c[i] = close[off + i]; }
   double f[], atr[], y[]; bool ok[], yok[];
   AT24AF_Series(nUse, h, l, c, f, atr, y, ok, yok);
   double mu[], sd[]; int sEnd;
   gHave = AT24AF_Scale(nUse, f, ok, yok, mu, sd, sEnd) && ok[nUse - 1];
   for(int i = 0; i < rates_total; i++) { B0[i] = EMPTY_VALUE; B1[i] = EMPTY_VALUE; B2[i] = EMPTY_VALUE; B3[i] = EMPTY_VALUE; B4[i] = EMPTY_VALUE; B5[i] = EMPTY_VALUE; }
   if(gHave)
     {
      gN = nUse; gAtr = atr[nUse - 1]; gPx = c[nUse - 1];
      AT24AF_Search(nUse - 1, nUse - 1 - AT24AF_FWD, f, ok, yok, y, mu, sd, gSt);
      for(int k = 0; k < gSt.k; k++) gVal[k] = y[gSt.idx[k]];
      //--- histogram bins over the analog outcomes
      double mn = gVal[0], mx = gVal[0];
      for(int k = 1; k < gSt.k; k++) { mn = MathMin(mn, gVal[k]); mx = MathMax(mx, gVal[k]); }
      double ext = MathMax(MathMax(MathAbs(mn), MathAbs(mx)), 0.5);
      gHistStep = 2.0 * MathCeil(ext * 2.0) / 2.0 / NBIN; gHistLo = -NBIN * gHistStep / 2.0;
      for(int b = 0; b < NBIN; b++) gHist[b] = 0;
      for(int k = 0; k < gSt.k; k++) { int b = (int)MathFloor((gVal[k] - gHistLo) / gHistStep); b = MathMax(0, MathMin(NBIN - 1, b)); gHist[b]++; }
      //--- self-test every 24 bars
      if(!gSelfOk || rates_total - gSelfAt >= 24)
        {
         AT24AF_SelfTest(nUse, f, ok, yok, y, mu, sd, sEnd, gSelf);
         gSelfOk = gSelf.ok; gSelfAt = rates_total;
        }
      int lb = rates_total - 2;
      B0[lb] = gPx + gSt.q50 * gAtr; B1[lb] = gPx + gSt.q10 * gAtr; B2[lb] = gPx + gSt.q90 * gAtr; B3[lb] = gSt.shareUp;
      if(gSelfOk) { B4[lb] = gSelf.bandHeld; B5[lb] = gSelf.hit; }
      //--- markers at the analog bars
      DelMarkers();
      if(InpMarkers)
        {
         for(int k = 0; k < gSt.k; k++)
           {
            int bi = off + gSt.idx[k];
            bool upk = gVal[k] > 0.0;
            string an = PFX + "mk" + IntegerToString(k);
            double a = MathMax(atr[gSt.idx[k]] * 0.5, _Point * 10);
            ObjectCreate(0, an, upk ? OBJ_ARROW_UP : OBJ_ARROW_DOWN, 0, time[bi], upk ? low[bi] - a : high[bi] + a);
            ObjectSetInteger(0, an, OBJPROP_COLOR, upk ? clrLimeGreen : clrTomato);
            ObjectSetInteger(0, an, OBJPROP_WIDTH, 2);
            ObjectSetInteger(0, an, OBJPROP_SELECTABLE, false);
            ObjectSetInteger(0, an, OBJPROP_HIDDEN, true);
            ObjectSetString(0, an, OBJPROP_TOOLTIP, StringFormat("analog %d: next 24 h %s ATR (%s)", k + 1, Sg(gVal[k]), TimeToString(time[bi], TIME_DATE | TIME_MINUTES)));
           }
        }
     }
   Draw();
   return rates_total;
  }
