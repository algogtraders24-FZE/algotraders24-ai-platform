//+------------------------------------------------------------------+
//| AT24 Volatility Forecast (MT5)                                   |
//| How big a move is usual in the next hours - with the time-of-day |
//| pattern built in - and how well that forecast really worked on   |
//| YOUR symbol versus a plain average or ATR.                       |
//| Context tool. Size of moves, NOT direction. Not a signal.        |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Volatility Forecast - expected move size for the next hours (time-of-day aware) + real calibration vs plain EWMA and ATR."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_VF_Core.mqh"

#resource "vf_logo56.bmp"

enum ENUM_AT24VF_EST
  {
   VF_CC = 0,   // Close-to-close
   VF_RS = 3    // Rogers-Satchell (uses open/high/low/close)
  };

input group "=== Forecast ==="
input ENUM_AT24VF_EST InpEstimator = VF_RS;  // Volatility estimator
input int    InpHorizonHours  = 8;      // Forecast horizon (hours)
input double InpLambda        = 0.94;   // EWMA decay (higher = slower)
input int    InpHistoryBars   = 8000;   // Bars analysed
input int    InpPctLook       = 2000;   // Bars used for the volatility percentile
input group "=== Look ==="
input bool   InpShowBand      = true;   // Draw the expected-move band from the last close
input color  InpBandColor     = clrDodgerBlue;  // 1 sigma lines
input color  InpBand2Color    = clrSlateGray;   // 2 sigma lines
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertHigh     = false;  // Alert when volatility crosses into the top 10 %
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24VF_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0, gH = 32;
double gSigH = 0.0, gPct = 0.0, gRel = 0.0, gClose = 0.0, gCal[8][4];
bool   gHigh = false;
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::vf_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

void Line(const string nm, const datetime t1, const datetime t2, const double p, const color col, const int style, const int width, const string txt)
  {
   ObjectCreate(0, nm, OBJ_TREND, 0, t1, p, t2, p);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, col);
   ObjectSetInteger(0, nm, OBJPROP_STYLE, style);
   ObjectSetInteger(0, nm, OBJPROP_WIDTH, width);
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

void DrawBand(const datetime &time[], const int rates_total)
  {
   ObjectsDeleteAll(0, PFX + "ln");
   if(!InpShowBand || gSigH <= 0.0) return;
   datetime t1 = time[rates_total - 1], t2 = time[rates_total - 1] + PeriodSeconds() * 14;
   double m = gClose * gSigH;
   Line(PFX + "lnu1", t1, t2, gClose + m, InpBandColor, STYLE_SOLID, 2, StringFormat("+1 sigma %dh", InpHorizonHours));
   Line(PFX + "lnd1", t1, t2, gClose - m, InpBandColor, STYLE_SOLID, 2, StringFormat("-1 sigma %dh", InpHorizonHours));
   Line(PFX + "lnu2", t1, t2, gClose + 2.0 * m, InpBand2Color, STYLE_DOT, 1, "+2 sigma");
   Line(PFX + "lnd2", t1, t2, gClose - 2.0 * m, InpBand2Color, STYLE_DOT, 1, "-2 sigma");
  }

void UpdateDash()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 VOLATILITY FORECAST", C'230,190,80', 10, true);
   string reg = gPct < 25.0 ? "LOW" : (gPct < 75.0 ? "NORMAL" : (gPct < 90.0 ? "HIGH" : "VERY HIGH"));
   color rc = gPct < 25.0 ? clrSlateGray : (gPct < 75.0 ? clrLimeGreen : (gPct < 90.0 ? clrGold : clrTomato));
   MakeLabel("t2", 70, 26, StringFormat("VOLATILITY: %s  (%.0fth pct)", reg, gPct), rc, 11, true);
   MakeLabel("l1", 10, 66, StringFormat("Next %dh: 1-sigma move +-%s (%.2f%%)", InpHorizonHours, DoubleToString(gClose * gSigH, Dg()), gSigH * 100.0), clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("2 sigma +-%s    now %.2fx its normal level", DoubleToString(2.0 * gClose * gSigH, Dg()), gRel), clrWhite, 9);
   int bi = (InpEstimator == VF_RS) ? 7 : 6;
   MakeLabel("h1", 10, 108, StringFormat("How the forecast worked (%d windows of %dh)", (int)gCal[bi][0], InpHorizonHours), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("This forecast:  corr %.2f   within +-30%%: %.0f%%", gCal[bi][1], gCal[bi][3]), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Plain average: corr %.2f   within +-30%%: %.0f%%", gCal[InpEstimator == VF_RS ? 3 : 0][1], gCal[InpEstimator == VF_RS ? 3 : 0][3]), clrSilver, 9);
   MakeLabel("s3", 10, 158, StringFormat("ATR(14) only:  corr %.2f   within +-30%%: %.0f%%  (runs %.0f%% low)", gCal[4][1], gCal[4][3], (1.0 - gCal[4][2]) * 100.0), clrSilver, 9);
   MakeLabel("n1", 10, 182, "Normal level = long-run average, time of day removed.", clrSlateGray, 8);
   MakeLabel("n2", 10, 196, "corr = how well the forecast tracked what followed.", clrSlateGray, 8);
   MakeLabel("n3", 10, 210, "Size of moves, NOT direction. Real tails are fat.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast of direction. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Volatility Forecast");
   if(InpHorizonHours < 1 || InpHorizonHours > 72 || InpLambda < 0.5 || InpLambda > 0.999 || InpPctLook < 100)
     {
      Print("AT24 Volatility Forecast: horizon 1-72 hours, decay 0.5-0.999, percentile bars >= 100.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(PeriodSeconds() > 3600)
     {
      Print("AT24 Volatility Forecast: use a chart of H1 or lower (time-of-day pattern needs intraday bars).");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   for(int a = 0; a < 8; a++) for(int b = 0; b < 4; b++) gCal[a][b] = 0.0;
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
   if(rates_total < 600) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only: estimators, forecasts and calibration never repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      int per = PeriodSeconds();
      gH = MathMax(1, InpHorizonHours * 3600 / per);
      double o[], h[], l[], c[]; ArrayResize(o, nb); ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb);
      int slot[]; ArrayResize(slot, nb);
      int S = MathMax(1, 86400 / per);
      for(int q = 0; q < nb; q++)
        {
         o[q] = open[base + q]; h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q];
         slot[q] = (int)(((long)time[base + q] % 86400) / per) % S;
        }
      double v0[], v1[], v2[], v3[];
      AT24VF_PerBar(nb, o, h, l, c, v0, v1, v2, v3);
      int warm = 100, start = 200;
      double s0[], s3[], atr[], sc[], sr[], lc[], lr[], out[];
      AT24VF_Ewma(nb, v0, InpLambda, warm, s0); AT24VF_Ewma(nb, v3, InpLambda, warm, s3);
      AT24VF_AtrPct(nb, h, l, c, 14, atr);
      AT24VF_Seasonal(nb, slot, S, v0, InpLambda, warm, gH, sc, lc);
      AT24VF_Seasonal(nb, slot, S, v3, InpLambda, warm, gH, sr, lr);
      AT24VF_Calib(nb, s0, v0, gH, start, out); for(int k = 0; k < 4; k++) gCal[0][k] = out[k];
      AT24VF_Calib(nb, s3, v0, gH, start, out); for(int k = 0; k < 4; k++) gCal[3][k] = out[k];
      AT24VF_Calib(nb, atr, v0, gH, start, out); for(int k = 0; k < 4; k++) gCal[4][k] = out[k];
      AT24VF_Calib(nb, sc, v0, gH, start, out); for(int k = 0; k < 4; k++) gCal[6][k] = out[k];
      AT24VF_Calib(nb, sr, v0, gH, start, out); for(int k = 0; k < 4; k++) gCal[7][k] = out[k];
      //--- current forecast: seasonal level x the schedule of the next H slots, from the last closed bar
      double fcast = (InpEstimator == VF_RS) ? sr[nb - 1] : sc[nb - 1];
      double lvl = (InpEstimator == VF_RS) ? lr[nb - 1] : lc[nb - 1];
      gSigH = fcast * MathSqrt((double)gH);
      gRel = lvl;
      if(InpEstimator == VF_RS) gPct = AT24VF_Percentile(lr, nb - 1, InpPctLook, lvl);
      else gPct = AT24VF_Percentile(lc, nb - 1, InpPctLook, lvl);
      gClose = c[nb - 1];
      DrawBand(time, rates_total);
      bool hi = (gPct >= 90.0);
      if(InpAlertHigh && hi && !gHigh && time[base + nb - 1] != gAlertBar)
        {
         gAlertBar = time[base + nb - 1];
         string msg = StringFormat("AT24 Volatility Forecast %s: volatility is in the top 10%% of its history (now %.1fx its normal level)", _Symbol, gRel);
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
      gHigh = hi;
      B0[0] = gSigH; B1[0] = gSigH * gClose; B2[0] = gPct; B3[0] = gRel; B4[0] = gCal[InpEstimator == VF_RS ? 7 : 6][1];
     }
   UpdateDash();
   return rates_total;
  }
