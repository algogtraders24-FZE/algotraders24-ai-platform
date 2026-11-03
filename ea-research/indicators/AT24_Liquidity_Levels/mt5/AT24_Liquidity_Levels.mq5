//+------------------------------------------------------------------+
//| AT24 Liquidity Levels (MT5)                                      |
//| Previous day / week / month high-low, marked untouched / swept / |
//| accepted - plus what really happened after sweeps on YOUR data.  |
//| Context tool. Not a signal. Past behaviour does not predict.     |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Liquidity Levels - PDH/PDL, PWH/PWL, PMH/PML with live state and sweep statistics."
#property description "Descriptive history on your broker's data. Context tool. Not a signal."
#property indicator_chart_window
#property indicator_buffers 6
#property indicator_plots   0

#include "AT24_Levels_Core.mqh"

#resource "lv_logo56.bmp"

input group "=== Levels ==="
input bool   InpShowWeek      = true;   // Show previous week high/low
input bool   InpShowMonth     = true;   // Show previous month high/low
input int    InpStatDays      = 60;     // Days used for the sweep statistics
input bool   InpAutoOffset    = true;   // Detect broker server time offset from GMT
input int    InpOffsetHours   = 0;      // Manual server offset in hours (if auto is off)
input group "=== Colours ==="
input color  InpDayColor      = clrGold;        // Day levels
input color  InpWeekColor     = clrDeepSkyBlue; // Week levels
input color  InpMonthColor    = clrOrchid;      // Month levels
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts (bar close) ==="
input bool   InpAlertSweep    = false;  // Alert when a day level is swept
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[], B5[];
string PFX = "AT24LV_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gLastTotal = 0;
AT24LV_Period gD[], gW[], gM[];
int    gND = 0, gNW = 0, gNM = 0;
double gStats[];
datetime gAlertHi = 0, gAlertLo = 0;

#define DASH_W 360
#define DASH_H 270

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::lv_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

color StateColor(const int s) { return (s == 0) ? clrWhite : (s == 1 ? clrOrange : clrTomato); }

//--- draw one level as a ray from the start of the period it belongs to
void DrawLevel(const string tag, const double price, const datetime from, const color base, const int state)
  {
   if(price <= 0.0) return;
   string n = PFX + "ln_" + tag, t = PFX + "tx_" + tag;
   color c = (state == 0) ? base : StateColor(state);
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_TREND, 0, from, price, from + 3600, price);
   ObjectSetInteger(0, n, OBJPROP_TIME, 0, from);
   ObjectSetDouble(0, n, OBJPROP_PRICE, 0, price);
   ObjectSetInteger(0, n, OBJPROP_TIME, 1, from + 3600);
   ObjectSetDouble(0, n, OBJPROP_PRICE, 1, price);
   ObjectSetInteger(0, n, OBJPROP_RAY_RIGHT, true);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_STYLE, state == 0 ? STYLE_SOLID : STYLE_DASH);
   ObjectSetInteger(0, n, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, true);
   if(ObjectFind(0, t) < 0) ObjectCreate(0, t, OBJ_TEXT, 0, from, price);
   ObjectSetInteger(0, t, OBJPROP_TIME, 0, from);
   ObjectSetDouble(0, t, OBJPROP_PRICE, 0, price);
   ObjectSetString(0, t, OBJPROP_TEXT, tag + " " + DoubleToString(price, _Digits) + (state == 0 ? "" : (state == 1 ? "  swept" : "  accepted")));
   ObjectSetInteger(0, t, OBJPROP_COLOR, c);
   ObjectSetInteger(0, t, OBJPROP_FONTSIZE, 8);
   ObjectSetInteger(0, t, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
   ObjectSetInteger(0, t, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, t, OBJPROP_HIDDEN, true);
  }

string Row(const string name, const double price, const int state, const double bid)
  {
   if(price <= 0.0) return StringFormat("%-4s  n/a", name);
   double d = bid - price;
   return StringFormat("%-4s %s   %s%s   %s", name, DoubleToString(price, _Digits), d >= 0 ? "+" : "", DoubleToString(d, _Digits), AT24LV_StateName(state));
  }

void UpdateAll(const bool redraw)
  {
   if(gND == 0) return;
   AT24LV_Period d = gD[gND - 1];
   AT24LV_Period w = (gNW > 0) ? gW[gNW - 1] : d;
   AT24LV_Period m = (gNM > 0) ? gM[gNM - 1] : d;
   int sdH = AT24LV_StateHi(d), sdL = AT24LV_StateLo(d);
   int swH = (gNW > 0) ? AT24LV_StateHi(w) : 0, swL = (gNW > 0) ? AT24LV_StateLo(w) : 0;
   int smH = (gNM > 0) ? AT24LV_StateHi(m) : 0, smL = (gNM > 0) ? AT24LV_StateLo(m) : 0;
   if(redraw)
     {
      DrawLevel("PDH", d.pHi, d.start, InpDayColor, sdH);
      DrawLevel("PDL", d.pLo, d.start, InpDayColor, sdL);
      if(InpShowWeek && gNW > 0) { DrawLevel("PWH", w.pHi, w.start, InpWeekColor, swH); DrawLevel("PWL", w.pLo, w.start, InpWeekColor, swL); }
      if(InpShowMonth && gNM > 0) { DrawLevel("PMH", m.pHi, m.start, InpMonthColor, smH); DrawLevel("PML", m.pLo, m.start, InpMonthColor, smL); }
     }
   B0[0] = d.pHi; B1[0] = d.pLo; B2[0] = (gNW > 0) ? w.pHi : 0.0; B3[0] = (gNW > 0) ? w.pLo : 0.0; B4[0] = (gNM > 0) ? m.pHi : 0.0; B5[0] = (gNM > 0) ? m.pLo : 0.0;
   if(!gDash) return;
   BuildFrame();
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   MakeLabel("t1", 70, 6, "AT24 LIQUIDITY LEVELS", C'230,190,80', 10, true);
   int worst = MathMax(MathMax(sdH, sdL), 0);
   string head = (sdH == 0 && sdL == 0) ? "Day levels untouched" : ((sdH != 0 && sdL != 0) ? "Both day levels swept" : (sdH != 0 ? "PDH swept" : "PDL swept"));
   MakeLabel("t2", 70, 26, head, StateColor(worst), 11, true);
   MakeLabel("r1", 10, 66, Row("PDH", d.pHi, sdH, bid), InpDayColor, 9);
   MakeLabel("r2", 10, 82, Row("PDL", d.pLo, sdL, bid), InpDayColor, 9);
   MakeLabel("r3", 10, 98, InpShowWeek ? Row("PWH", w.pHi, swH, bid) : "PWH  hidden", InpWeekColor, 9);
   MakeLabel("r4", 10, 114, InpShowWeek ? Row("PWL", w.pLo, swL, bid) : "PWL  hidden", InpWeekColor, 9);
   MakeLabel("r5", 10, 130, InpShowMonth ? Row("PMH", m.pHi, smH, bid) : "PMH  hidden", InpMonthColor, 9);
   MakeLabel("r6", 10, 146, InpShowMonth ? Row("PML", m.pLo, smL, bid) : "PML  hidden", InpMonthColor, 9);
   MakeLabel("h1", 10, 170, StringFormat("Last %d days on this symbol  (%d with a previous-day level)", InpStatDays, (int)gStats[0]), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 188, StringFormat("PDH swept %.0f%%   PDL swept %.0f%%   either %.0f%%   both %.0f%%", gStats[1], gStats[2], gStats[3], gStats[4]), clrWhite, 9);
   MakeLabel("s2", 10, 204, StringFormat("After a sweep: back inside %.0f%% | accepted %.0f%% (%d)", gStats[5], gStats[6], (int)gStats[7]), clrWhite, 9);
   MakeLabel("n1", 10, 224, "Swept = traded beyond. Accepted = closed beyond.", clrSlateGray, 8);
   MakeLabel("f1", 10, 246, "Descriptive history on your broker's data. Context tool,", clrSlateGray, 7);
   MakeLabel("f2", 10, 258, "not a signal or a forecast. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS); SetIndexBuffer(5, B5, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true); ArraySetAsSeries(B5, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Liquidity Levels");
   if(InpStatDays < 5) { Print("AT24 Liquidity Levels: use at least 5 statistics days."); return INIT_PARAMETERS_INCORRECT; }
   if(PeriodSeconds(_Period) > 14400 || PeriodSeconds(_Period) < 300) { Print("AT24 Liquidity Levels: use a chart timeframe from M5 to H4."); return INIT_PARAMETERS_INCORRECT; }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
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
   if(rates_total < 50) return 0;
   bool recalc = (prev_calculated == 0 || rates_total != gLastTotal);
   if(recalc)
     {
      gLastTotal = rates_total;
      int off = ServerOffsetSec();
      //--- closed bars only: levels and sweeps never repaint
      gND = AT24LV_Analyze(rates_total - 1, time, high, low, close, off, 0, InpStatDays + 2, gD);
      gNW = AT24LV_Analyze(rates_total - 1, time, high, low, close, off, 1, 20, gW);
      gNM = AT24LV_Analyze(rates_total - 1, time, high, low, close, off, 2, 10, gM);
      AT24LV_Stats(gD, gND, gStats);
      if(InpAlertSweep && gND > 0)
        {
         AT24LV_Period d = gD[gND - 1];
         if(d.swHiT != 0 && d.swHiT != gAlertHi) { gAlertHi = d.swHiT; Alert("AT24 Liquidity Levels ", _Symbol, ": PDH ", DoubleToString(d.pHi, _Digits), " swept"); if(InpAlertPush) SendNotification("AT24 " + _Symbol + ": PDH swept"); }
         if(d.swLoT != 0 && d.swLoT != gAlertLo) { gAlertLo = d.swLoT; Alert("AT24 Liquidity Levels ", _Symbol, ": PDL ", DoubleToString(d.pLo, _Digits), " swept"); if(InpAlertPush) SendNotification("AT24 " + _Symbol + ": PDL swept"); }
        }
     }
   UpdateAll(recalc);
   return rates_total;
  }
