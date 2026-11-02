//+------------------------------------------------------------------+
//| AT24 Prop Guard (MT5)                                            |
//| Know how much room you have left before your daily / max loss.   |
//| Dashboard for the limits YOU configure. Not a guarantee, not     |
//| affiliated with any prop firm.                                   |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Prop Guard - daily loss, max loss, open risk and target progress on your chart."
#property description "Set the limits of your challenge or account. Context tool. Not a guarantee."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_PropGuard_Core.mqh"

#resource "pg_logo56.bmp"

enum ENUM_AT24PG_BASIS
  {
   PG_START_BALANCE = 0,  // Day start = balance at reset (rebuilt from history)
   PG_START_EQUITY  = 1   // Day start = equity when first seen after reset
  };

input group "=== Your limits ==="
input double InpInitialBalance = 0;      // Initial balance / account size (0 = balance when first attached)
input double InpDailyLossPct   = 5.0;    // Daily loss limit, % of day-start value
input double InpMaxLossPct     = 10.0;   // Max total loss limit, % of initial balance
input double InpTargetPct      = 10.0;   // Profit target, % of initial balance (0 = hide)
input group "=== Day definition ==="
input int    InpResetHour      = 0;      // Daily reset hour (broker server time)
input ENUM_AT24PG_BASIS InpBasis = PG_START_BALANCE; // How the day start is measured
input group "=== Dashboard ==="
input bool   InpShowDash       = true;   // Show dashboard
input bool   InpDashInTester   = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX          = 12;     // Dashboard X offset
input int    InpDashY          = 24;     // Dashboard Y offset
input group "=== Alerts ==="
input bool   InpAlert          = false;  // Alert at 80% and 95% of a limit
input bool   InpAlertPush      = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];   // daily used %, total used %, daily left $, total left $, open risk $
string PFX = "AT24PG_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
datetime gLastHist = 0;
double gHistSum = 0.0;
int    gHistKey = 0;
int    gAlertLevel = 0, gAlertKey = 0;
bool   gTester = false;

#define DASH_W 320
#define DASH_H 262
#define GAUGE_W 300

string GV(const string k) { return "AT24PG_" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + k; }

color StatusColor(const int s)
  {
   switch(s)
     {
      case 1: return clrLimeGreen;
      case 2: return clrGold;
      case 3: return clrOrange;
      case 4: return clrTomato;
     }
   return clrSlateGray;
  }

string Money(const double v)
  {
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   return StringFormat("%s%s", v < 0 ? "-" : "", DoubleToString(MathAbs(v), 2)) + " " + cur;
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

void MakeRect(const string name, const int x, const int y, const int w, const int h, const color bg, const color border)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, MathMax(1, w));
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
  }

void BuildFrame()
  {
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40', C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::pg_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

//--- sum of all deals (profit + swap + commission + fee, incl. deposits/withdrawals) since `from`
double DealsSince(const datetime from)
  {
   if(!HistorySelect(from, TimeCurrent() + 86400)) return 0.0;
   double s = 0.0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      s += HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP)
           + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
     }
   return s;
  }

//--- loss if every open position with a stop loss is stopped out; counts positions without SL
double OpenRisk(int &noSL)
  {
   noSL = 0;
   double risk = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      double sl = PositionGetDouble(POSITION_SL);
      if(sl <= 0.0) { noSL++; continue; }
      ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double p = 0.0;
      if(OrderCalcProfit(pt == POSITION_TYPE_BUY ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, PositionGetString(POSITION_SYMBOL),
                         PositionGetDouble(POSITION_VOLUME), PositionGetDouble(POSITION_PRICE_OPEN), sl, p))
         if(p < 0.0) risk += -p;
     }
   return risk;
  }

void Refresh(const bool writeBuffers)
  {
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   if(AccountInfoInteger(ACCOUNT_LOGIN) == 0 || balance <= 0.0)   // not connected yet: never store or show zeros
     {
      if(writeBuffers) { B0[0] = B1[0] = B2[0] = B3[0] = B4[0] = EMPTY_VALUE; }
      if(gDash)
        {
         BuildFrame();
         MakeLabel("t1", 70, 6, "AT24 PROP GUARD", C'230,190,80', 10, true);
         MakeLabel("t2", 70, 26, "WAITING FOR ACCOUNT DATA", clrSlateGray, 10, true);
        }
      return;
     }
   datetime now = TimeCurrent();
   int key = AT24PG_DayKey(now, InpResetHour);

   //--- initial balance
   double initial = InpInitialBalance;
   if(initial <= 0.0)
     {
      if(!GlobalVariableCheck(GV("init"))) GlobalVariableSet(GV("init"), balance);
      initial = GlobalVariableGet(GV("init"));
     }

   //--- day start value
   double dayBase;
   string basisTxt;
   if(InpBasis == PG_START_BALANCE)
     {
      if(key != gHistKey || now - gLastHist >= 5)
        {
         gHistSum = DealsSince(AT24PG_DayStart(now, InpResetHour));
         gHistKey = key; gLastHist = now;
        }
      dayBase = balance - gHistSum;
      basisTxt = "balance at reset";
     }
   else
     {
      if(!GlobalVariableCheck(GV("dk")) || (int)GlobalVariableGet(GV("dk")) != key)
        { GlobalVariableSet(GV("dk"), key); GlobalVariableSet(GV("ds"), equity); }
      dayBase = GlobalVariableGet(GV("ds"));
      basisTxt = "equity when first seen";
     }

   double o[];
   AT24PG_Calc(dayBase, equity, initial, InpDailyLossPct, InpMaxLossPct, InpTargetPct, o);
   int noSL = 0;
   double risk = OpenRisk(noSL);

   if(writeBuffers)
     {
      B0[0] = o[3] * 100.0; B1[0] = o[6] * 100.0; B2[0] = o[2]; B3[0] = o[5]; B4[0] = risk;
     }

   double worst = MathMax(o[3], o[6]);
   int st = AT24PG_Status(worst);

   //--- alerts (once per level per trading day)
   if(gAlertKey != key) { gAlertKey = key; gAlertLevel = 0; }
   int lvl = (worst >= 0.95) ? 2 : (worst >= 0.80 ? 1 : 0);
   if(InpAlert && lvl > gAlertLevel && !gTester)
     {
      string msg = StringFormat("AT24 Prop Guard: %s at %.0f%% of its limit (daily %.0f%%, total %.0f%%)",
                                (o[3] >= o[6]) ? "daily loss" : "total loss", worst * 100.0, o[3] * 100.0, o[6] * 100.0);
      Alert(msg);
      if(InpAlertPush) SendNotification(msg);
     }
   if(lvl > gAlertLevel) gAlertLevel = lvl;

   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 PROP GUARD", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, AT24PG_StatusName(st), StatusColor(st), 11, true);

   MakeLabel("l1", 10, 66, StringFormat("Daily loss   %.0f%% used   %s of %s", MathMin(o[3], 9.99) * 100.0, Money(MathMax(0.0, -o[1])), Money(o[0])), clrWhite, 9);
   MakeRect("g1bg", 10, 84, GAUGE_W, 10, C'30,44,66', C'30,44,66');
   MakeRect("g1", 10, 84, (int)(GAUGE_W * MathMin(1.0, o[3])), 10, StatusColor(AT24PG_Status(o[3])), StatusColor(AT24PG_Status(o[3])));
   MakeLabel("l2", 10, 100, StringFormat("Total loss   %.0f%% used   %s of %s", MathMin(o[6], 9.99) * 100.0, Money(MathMax(0.0, initial - equity)), Money(o[4])), clrWhite, 9);
   MakeRect("g2bg", 10, 118, GAUGE_W, 10, C'30,44,66', C'30,44,66');
   MakeRect("g2", 10, 118, (int)(GAUGE_W * MathMin(1.0, o[6])), 10, StatusColor(AT24PG_Status(o[6])), StatusColor(AT24PG_Status(o[6])));

   MakeLabel("l3", 10, 136, "Left today  " + Money(o[2]), o[2] <= 0 ? clrTomato : clrWhite, 9);
   MakeLabel("l4", 10, 152, "Left overall  " + Money(o[5]), o[5] <= 0 ? clrTomato : clrWhite, 9);
   MakeLabel("l5", 10, 168, StringFormat("Open risk if all SL hit  %s%s", Money(risk), noSL > 0 ? StringFormat("   (%d without SL)", noSL) : ""), noSL > 0 ? clrOrange : clrWhite, 9);
   MakeLabel("l6", 10, 184, InpTargetPct > 0 ? StringFormat("Profit target  %.0f%% of %.1f%%", MathMax(0.0, o[7]) * 100.0, InpTargetPct) : "Profit target  off", clrLimeGreen, 9);
   MakeLabel("l7", 10, 200, StringFormat("Day start %s  (%s, reset %02d:00 server)", Money(dayBase), basisTxt, InpResetHour), clrSlateGray, 8);
   MakeLabel("l8", 10, 216, StringFormat("Binding limit: %s", (o[3] >= o[6]) ? "DAILY" : "TOTAL"), clrGold, 8);
   MakeLabel("f1", 10, 234, "Context tool, not a guarantee. algotraders24.ai", clrSlateGray, 7);
   MakeLabel("f2", 10, 246, "Set your own limits. Not affiliated with any firm.", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS);
   SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS);
   SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Prop Guard");
   if(InpDailyLossPct <= 0 || InpMaxLossPct <= 0 || InpResetHour < 0 || InpResetHour > 23)
     {
      Print("AT24 Prop Guard: loss limits must be above 0 and reset hour 0-23.");
      return INIT_PARAMETERS_INCORRECT;
     }
   gTester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!gTester || (InpDashInTester && visual));
   EventSetTimer(2);
   return INIT_SUCCEEDED;
  }

void OnTimer() { if(gDash) Refresh(false); }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, PFX);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 2) return 0;
   Refresh(true);
   return rates_total;
  }

