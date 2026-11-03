//+------------------------------------------------------------------+
//| AT24 Anchored VWAP (MT5)                                         |
//| Day / week / month VWAP with deviation bands - and a real test   |
//| of what price did after stretching 2 deviations from day VWAP.   |
//| Volume = tick volume. Context tool. Not a signal.                |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Anchored VWAP - day/week/month VWAP, deviation bands and a real mean-reversion test."
#property description "Uses tick volume (the volume MT5 provides for FX / CFDs). Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 8
#property indicator_plots   7

#property indicator_label1  "Day VWAP"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrGold
#property indicator_width1  2

#property indicator_label2  "Day +1 SD"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrDarkGoldenrod
#property indicator_style2  STYLE_DOT

#property indicator_label3  "Day -1 SD"
#property indicator_type3   DRAW_LINE
#property indicator_color3  clrDarkGoldenrod
#property indicator_style3  STYLE_DOT

#property indicator_label4  "Day +2 SD"
#property indicator_type4   DRAW_LINE
#property indicator_color4  clrSienna
#property indicator_style4  STYLE_DOT

#property indicator_label5  "Day -2 SD"
#property indicator_type5   DRAW_LINE
#property indicator_color5  clrSienna
#property indicator_style5  STYLE_DOT

#property indicator_label6  "Week VWAP"
#property indicator_type6   DRAW_LINE
#property indicator_color6  clrDeepSkyBlue
#property indicator_width6  1

#property indicator_label7  "Month VWAP"
#property indicator_type7   DRAW_LINE
#property indicator_color7  clrOrchid
#property indicator_width7  1

#include "AT24_VWAP_Core.mqh"

#resource "vw_logo56.bmp"

input group "=== VWAP ==="
input bool   InpShowWeek      = true;   // Show week VWAP
input bool   InpShowMonth     = true;   // Show month VWAP
input bool   InpAutoOffset    = true;   // Detect broker server time offset from GMT
input int    InpOffsetHours   = 0;      // Manual server offset in hours (if auto is off)
input int    InpHistoryBars   = 8000;   // Bars analysed
input group "=== Mean-reversion test (day VWAP) ==="
input double InpStartSd       = 2.0;    // Event: close this many SD from the day VWAP
input double InpExtendSd      = 3.0;    // Extension: a close this many SD from the VWAP
input int    InpMinBars       = 10;     // Bars into the day before an event can count
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertDev      = false;  // Alert when price closes beyond the start SD from day VWAP
input bool   InpAlertPush     = false;  // Also send push notification

double BDay[], BU1[], BD1[], BU2[], BD2[], BWeek[], BMonth[], BSd[];
string PFX = "AT24VW_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
double gRev[6];
double gVd = 0, gSd = 0, gVw = 0, gSw = 0, gVm = 0, gSm = 0;
bool   gHaveW = false, gHaveM = false;
datetime gAlertBar = 0;
int    gLastTotal = 0;

#define DASH_W 370
#define DASH_H 262

int ServerOffsetSec()
  {
   if(!InpAutoOffset) return InpOffsetHours * 3600;
   return (int)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;
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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::vw_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

int Dg() { return (_Digits >= 4) ? _Digits : 2; }

string VRow(const string name, const double price, const double vwap, const double sd)
  {
   if(vwap <= 0.0) return name + "  n/a";
   double d = price - vwap;
   return StringFormat("%s  %s  %s%s  (%s%.1f SD)", name, DoubleToString(vwap, Dg()), d >= 0 ? "+" : "", DoubleToString(d, Dg()), d >= 0 ? "+" : "", sd > 0 ? d / sd : 0.0);
  }

void UpdateDash(const double price)
  {
   if(!gDash) return;
   BuildFrame();
   double dev = (gSd > 0.0) ? (price - gVd) / gSd : 0.0;
   color sc = (MathAbs(dev) >= InpStartSd) ? clrTomato : (MathAbs(dev) >= 1.0 ? clrGold : clrLimeGreen);
   MakeLabel("t1", 70, 6, "AT24 ANCHORED VWAP", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, StringFormat("%s day VWAP  %+.1f SD", dev >= 0 ? "ABOVE" : "BELOW", dev), sc, 11, true);
   MakeLabel("r1", 10, 66, VRow("Day  ", price, gVd, gSd), clrGold, 9);
   MakeLabel("r2", 10, 82, InpShowWeek ? VRow("Week ", price, gHaveW ? gVw : 0, gSw) : "Week  hidden", clrDeepSkyBlue, 9);
   MakeLabel("r3", 10, 98, InpShowMonth ? VRow("Month", price, gHaveM ? gVm : 0, gSm) : "Month hidden", clrOrchid, 9);
   MakeLabel("h1", 10, 124, StringFormat("Day VWAP test, last %d bars (%d days measured):", InpHistoryBars, (int)gRev[0]), C'230,190,80', 9, true);
   double n = gRev[0];
   MakeLabel("s1", 10, 142, StringFormat("After a close %.0f SD out: back to VWAP %.0f%%", InpStartSd, n > 0 ? 100.0 * gRev[1] / n : 0.0), clrWhite, 9);
   MakeLabel("s2", 10, 158, StringFormat("went on to %.0f SD %.0f%%   neither %.0f%%", InpExtendSd, n > 0 ? 100.0 * gRev[2] / n : 0.0, n > 0 ? 100.0 * gRev[3] / n : 0.0), clrWhite, 9);
   MakeLabel("s3", 10, 174, StringFormat("Closes above day VWAP: %.0f%% of bars", gRev[4]), clrWhite, 9);
   MakeLabel("n1", 10, 196, "Random-walk yardstick: back to VWAP about 33% when", clrSlateGray, 8);
   MakeLabel("n2", 10, 210, "the stretch is 2 SD and the extension 3 SD. Volume = ticks.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, BDay, INDICATOR_DATA); SetIndexBuffer(1, BU1, INDICATOR_DATA); SetIndexBuffer(2, BD1, INDICATOR_DATA);
   SetIndexBuffer(3, BU2, INDICATOR_DATA); SetIndexBuffer(4, BD2, INDICATOR_DATA); SetIndexBuffer(5, BWeek, INDICATOR_DATA);
   SetIndexBuffer(6, BMonth, INDICATOR_DATA); SetIndexBuffer(7, BSd, INDICATOR_CALCULATIONS);
   for(int p = 0; p < 7; p++) PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Anchored VWAP");
   if(InpStartSd <= 0 || InpExtendSd <= InpStartSd || InpMinBars < 3)
     {
      Print("AT24 Anchored VWAP: need 0 < start SD < extension SD and at least 3 bars into the day.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayInitialize(gRev, 0.0);
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
   if(rates_total < 100) return 0;
   int nb = (int)MathMin((double)rates_total, (double)InpHistoryBars);
   int base = rates_total - nb;
   int off = ServerOffsetSec();
   double h[], l[], c[]; long v[]; datetime t[];
   ArrayResize(h, nb); ArrayResize(l, nb); ArrayResize(c, nb); ArrayResize(v, nb); ArrayResize(t, nb);
   for(int q = 0; q < nb; q++) { h[q] = high[base + q]; l[q] = low[base + q]; c[q] = close[base + q]; v[q] = tick_volume[base + q]; t[q] = time[base + q]; }
   double vd[], sdd[], vw[], sdw[], vm[], sdm[]; int fd[], fw[], fm[];
   ArrayResize(vd, nb); ArrayResize(sdd, nb); ArrayResize(fd, nb);
   ArrayResize(vw, nb); ArrayResize(sdw, nb); ArrayResize(fw, nb);
   ArrayResize(vm, nb); ArrayResize(sdm, nb); ArrayResize(fm, nb);
   AT24VW_Calc(nb, t, h, l, c, v, off, 0, vd, sdd, fd);
   AT24VW_Calc(nb, t, h, l, c, v, off, 1, vw, sdw, fw);
   AT24VW_Calc(nb, t, h, l, c, v, off, 2, vm, sdm, fm);
   if(prev_calculated == 0 || rates_total != gLastTotal)
     {
      gLastTotal = rates_total;
      //--- the reversion test uses CLOSED bars only (no repaint)
      AT24VW_Reversion(nb - 1, h, l, c, vd, sdd, fd, InpStartSd, InpExtendSd, InpMinBars, gRev);
      ArrayInitialize(BDay, EMPTY_VALUE); ArrayInitialize(BU1, EMPTY_VALUE); ArrayInitialize(BD1, EMPTY_VALUE);
      ArrayInitialize(BU2, EMPTY_VALUE); ArrayInitialize(BD2, EMPTY_VALUE); ArrayInitialize(BWeek, EMPTY_VALUE); ArrayInitialize(BMonth, EMPTY_VALUE);
      ArrayInitialize(BSd, 0);
      if(InpAlertDev && nb > 12)
        {
         int ic = nb - 2;   // last closed bar
         if(sdd[ic] > 0.0 && MathAbs((c[ic] - vd[ic]) / sdd[ic]) >= InpStartSd && time[base + ic] != gAlertBar)
           {
            gAlertBar = time[base + ic];
            string msg = StringFormat("AT24 Anchored VWAP %s: close %.1f SD from the day VWAP", _Symbol, (c[ic] - vd[ic]) / sdd[ic]);
            Alert(msg);
            if(InpAlertPush) SendNotification(msg);
           }
        }
     }
   for(int q2 = 0; q2 < nb; q2++)
     {
      int i = base + q2;
      bool brk = (fd[q2] == 1);
      BDay[i] = brk ? EMPTY_VALUE : vd[q2];
      BU1[i] = brk ? EMPTY_VALUE : vd[q2] + sdd[q2];  BD1[i] = brk ? EMPTY_VALUE : vd[q2] - sdd[q2];
      BU2[i] = brk ? EMPTY_VALUE : vd[q2] + 2.0 * sdd[q2]; BD2[i] = brk ? EMPTY_VALUE : vd[q2] - 2.0 * sdd[q2];
      BWeek[i] = (InpShowWeek && fw[q2] == 0) ? vw[q2] : EMPTY_VALUE;
      BMonth[i] = (InpShowMonth && fm[q2] == 0) ? vm[q2] : EMPTY_VALUE;
      BSd[i] = sdd[q2];
     }
   int z = nb - 1;
   gVd = vd[z]; gSd = sdd[z]; gVw = vw[z]; gSw = sdw[z]; gVm = vm[z]; gSm = sdm[z];
   gHaveW = true; gHaveM = true;
   UpdateDash(close[rates_total - 1]);
   return rates_total;
  }
