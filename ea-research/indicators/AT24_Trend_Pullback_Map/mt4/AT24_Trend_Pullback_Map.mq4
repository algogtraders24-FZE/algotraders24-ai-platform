//+------------------------------------------------------------------+
//| AT24 Trend Pullback Map (MT4)                                    |
//| EMA ribbon, trend / range state, pullback zone - and how EMA     |
//| pullbacks really ended on YOUR symbol.                           |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Trend Pullback Map - EMA ribbon, trend state, pullback zone and real pullback statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 8
#property indicator_color1  clrGold
#property indicator_color2  clrLimeGreen
#property indicator_color3  clrTomato
#property indicator_color4  clrDimGray
#property indicator_color5  clrDeepSkyBlue
#property indicator_color6  clrLimeGreen
#property indicator_color7  clrTomato

#include "AT24_Pullback_Core.mqh"

#resource "tp_logo56.bmp"

// === Ribbon ===
input int    InpFast          = 20;     // Fast EMA
input int    InpMid           = 50;     // Mid EMA (trend colour, pullback failure level)
input int    InpSlow          = 200;    // Slow EMA
input int    InpAtr           = 14;     // ATR period
input int    InpSlopeBars     = 5;      // Bars used for the mid EMA slope
input double InpSlopeMinAtr   = 0.10;   // Mid EMA must move this many ATR over the slope bars
// === Pullback statistics ===
input int    InpSwingBars     = 20;     // Bars before the touch that define the swing extreme
input int    InpWindow        = 20;     // Bars allowed for the pullback to resolve
input double InpExtendedAtr   = 1.5;    // Price this many ATR from the fast EMA = extended
input int    InpHistoryBars   = 8000;   // Bars analysed
// === Dashboard ===
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
// === Alerts (bar close) ===
input bool   InpAlertTouch    = false;  // Alert on a new pullback touch
input bool   InpAlertPush     = false;  // Also send push notification

double BufF[], BufMU[], BufMD[], BufMR[], BufS[], BufAU[], BufAD[], BufTrend[];
double gTmp[];
string PFX = "AT24TP_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
double gStats[];
datetime gAlertBar = 0;
AT24TP_Ev gEv[];
int    gNEv = 0;
int    gTrendNow = 0, gZoneNow = 0;
double gDistAtr = 0.0;

#define DASH_W 340
#define DASH_H 250

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::tp_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

//--- zone: for an up trend 1 running (above fast EMA), 2 extended, 3 in the pullback zone (between fast and mid), 4 deeper than the zone, 5 trend broken (below slow)
string ZoneName(const int trend, const int z)
  {
   if(trend == 0) return "RANGE / NO CLEAR TREND";
   if(z == 1) return "TREND RUNNING (above fast EMA)";
   if(z == 2) return "EXTENDED from the fast EMA";
   if(z == 3) return "IN THE PULLBACK ZONE";
   if(z == 4) return "PULLBACK DEEPER THAN THE ZONE";
   return "TREND BROKEN (through the slow EMA)";
  }

void UpdateDash(const double price)
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 TREND PULLBACK MAP", C'230,190,80', 10, true);
   string tn = (gTrendNow == 1) ? "UPTREND" : (gTrendNow == -1 ? "DOWNTREND" : "RANGE");
   color tc = (gTrendNow == 1) ? clrLimeGreen : (gTrendNow == -1 ? clrTomato : clrSlateGray);
   MakeLabel("t2", 70, 26, tn, tc, 11, true);
   MakeLabel("z1", 10, 66, ZoneName(gTrendNow, gZoneNow), (gZoneNow == 3) ? clrGold : clrWhite, 9);
   MakeLabel("z2", 10, 82, StringFormat("Price vs fast EMA  %+.2f ATR", gDistAtr), clrWhite, 9);
   MakeLabel("h1", 10, 108, StringFormat("Pullback touches in the last %d bars  (%d resolved)", InpHistoryBars, (int)gStats[0]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 126, StringFormat("Trend resumed (new swing) %.0f%%   failed %.0f%%   neither %.0f%%", gStats[1], gStats[2], gStats[3]), clrWhite, 9);
   MakeLabel("s2", 10, 142, StringFormat("Median depth %.1f ATR   median bars to resolve %.0f", gStats[4], gStats[5]), clrWhite, 9);
   MakeLabel("s3", 10, 158, StringFormat("Up-trend touches %d   down-trend touches %d", (int)gStats[6], (int)gStats[7]), clrSlateGray, 8);
   MakeLabel("n1", 10, 178, StringFormat("Resumed = new %d-bar extreme before a close past the %d EMA.", InpSwingBars, InpMid), clrSlateGray, 8);
   MakeLabel("f1", 10, 214, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 226, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, BufF); SetIndexBuffer(1, BufMU); SetIndexBuffer(2, BufMD); SetIndexBuffer(3, BufMR);
   SetIndexBuffer(4, BufS); SetIndexBuffer(5, BufAU); SetIndexBuffer(6, BufAD); SetIndexBuffer(7, BufTrend);
   SetIndexStyle(0, DRAW_LINE, STYLE_SOLID, 1);
   SetIndexStyle(1, DRAW_LINE, STYLE_SOLID, 2); SetIndexStyle(2, DRAW_LINE, STYLE_SOLID, 2); SetIndexStyle(3, DRAW_LINE, STYLE_SOLID, 2);
   SetIndexStyle(4, DRAW_LINE, STYLE_SOLID, 1);
   SetIndexStyle(5, DRAW_ARROW); SetIndexArrow(5, 233);
   SetIndexStyle(6, DRAW_ARROW); SetIndexArrow(6, 234);
   SetIndexStyle(7, DRAW_NONE);
   for(int k = 0; k < 8; k++) SetIndexEmptyValue(k, EMPTY_VALUE);
   SetIndexLabel(0, "EMA fast"); SetIndexLabel(1, "EMA mid (up trend)"); SetIndexLabel(2, "EMA mid (down trend)"); SetIndexLabel(3, "EMA mid (range)");
   SetIndexLabel(4, "EMA slow"); SetIndexLabel(5, "Pullback touch (up)"); SetIndexLabel(6, "Pullback touch (down)"); SetIndexLabel(7, "Trend state");
   IndicatorShortName("AT24 Trend Pullback Map");
   if(InpFast >= InpMid || InpMid >= InpSlow || InpFast < 2 || InpSlopeBars < 1 || InpSwingBars < 2 || InpWindow < 2)
     {
      Print("AT24 Trend Pullback Map: need fast < mid < slow EMAs and sensible bar counts.");
      return INIT_PARAMETERS_INCORRECT;
     }
   gDash = InpShowDash && (!IsTesting() || (InpDashInTester && IsVisualMode()));
   ArrayResize(gStats, 8);
   for(int z = 0; z < 8; z++) gStats[z] = 0.0;
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
   if(rates_total < InpSlow + InpSlopeBars + 50) return 0;
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- closed bars only (the forming bar can still change): no repaint
      int total = rates_total - 1;
      int nb = (int)MathMin((double)total, (double)InpHistoryBars);
      int base = total - nb;
      double h[], l[], c[], ef[], em[], es[], at[];
      int tr[];
      ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb); ArrayResize(ef, nb); ArrayResize(em, nb); ArrayResize(es, nb); ArrayResize(at, nb); ArrayResize(tr, nb);
      //--- MQL4 may hand the input arrays over newest-first: read through a chronological index
      bool ser = ArrayGetAsSeries(close);
      for(int qa = 0; qa < nb; qa++)
        {
         int ci = base + qa;
         int sx = ser ? rates_total - 1 - ci : ci;
         h[qa] = high[sx]; l[qa] = low[sx]; c[qa] = close[sx];
        }
      AT24TP_Ema(nb, c, InpFast, ef);
      AT24TP_Ema(nb, c, InpMid, em);
      AT24TP_Ema(nb, c, InpSlow, es);
      AT24TP_Atr(nb, h, l, c, InpAtr, at);
      AT24TP_Trend(nb, ef, em, es, at, InpSlow, InpSlopeBars, InpSlopeMinAtr, tr);
      gNEv = AT24TP_Events(nb, h, l, c, ef, em, at, tr, InpSwingBars, InpWindow, gEv);
      AT24TP_Stats(gEv, gNEv, gStats);
      ArraySetAsSeries(BufF, false); ArraySetAsSeries(BufMU, false); ArraySetAsSeries(BufMD, false); ArraySetAsSeries(BufMR, false);
      ArraySetAsSeries(BufS, false); ArraySetAsSeries(BufAU, false); ArraySetAsSeries(BufAD, false); ArraySetAsSeries(BufTrend, false);
      ArrayInitialize(BufF, EMPTY_VALUE); ArrayInitialize(BufMU, EMPTY_VALUE); ArrayInitialize(BufMD, EMPTY_VALUE); ArrayInitialize(BufMR, EMPTY_VALUE);
      ArrayInitialize(BufS, EMPTY_VALUE); ArrayInitialize(BufAU, EMPTY_VALUE); ArrayInitialize(BufAD, EMPTY_VALUE); ArrayInitialize(BufTrend, 0);
      for(int q = InpSlow; q < nb; q++)
        {
         int i = base + q;
         BufF[i] = ef[q]; BufS[i] = es[q];
         if(tr[q] == 1) BufMU[i] = em[q]; else if(tr[q] == -1) BufMD[i] = em[q]; else BufMR[i] = em[q];
         BufTrend[i] = tr[q];
        }
      for(int k = 0; k < gNEv; k++)
        {
         int i2 = base + gEv[k].idx;
         int sx2 = ser ? rates_total - 1 - i2 : i2;
         if(gEv[k].dir == 1) BufAU[i2] = low[sx2]; else BufAD[i2] = high[sx2];
        }
      //--- state of the last CLOSED bar
      int z = nb - 1;
      gTrendNow = tr[z];
      gDistAtr = (at[z] > 0.0) ? (c[z] - ef[z]) / at[z] : 0.0;
      int zone = 0;
      if(gTrendNow == 1)
        {
         if(c[z] < es[z]) zone = 5;
         else if(c[z] < em[z]) zone = 4;
         else if(c[z] <= ef[z] || l[z] <= ef[z]) zone = 3;
         else zone = (gDistAtr > InpExtendedAtr) ? 2 : 1;
        }
      else if(gTrendNow == -1)
        {
         if(c[z] > es[z]) zone = 5;
         else if(c[z] > em[z]) zone = 4;
         else if(c[z] >= ef[z] || h[z] >= ef[z]) zone = 3;
         else zone = (-gDistAtr > InpExtendedAtr) ? 2 : 1;
        }
      gZoneNow = zone;
      if(InpAlertTouch && gNEv > 0 && gEv[gNEv - 1].idx == nb - 1 && time[ser ? rates_total - 1 - (base + z) : base + z] != gAlertBar)
        {
         gAlertBar = time[ser ? rates_total - 1 - (base + z) : base + z];
         string msg = StringFormat("AT24 Trend Pullback Map %s: pullback touch of the fast EMA in an %s", _Symbol, gEv[gNEv - 1].dir == 1 ? "UPTREND" : "DOWNTREND");
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
     }
   UpdateDash(close[rates_total - 1]);
   return rates_total;
  }
