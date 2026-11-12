//+------------------------------------------------------------------+
//| AT24 Trade Planner (MT5)                                         |
//| Drag the Entry, Stop and Target lines on the chart: lots for     |
//| your risk, money at risk and at the target, R:R, margin, costs   |
//| and how much of your remaining daily loss limit the trade uses.  |
//| A planning calculator. It places no orders. Not a signal.        |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Trade Planner - drag Entry / Stop / Target lines; shows lots, risk, reward, R:R, margin, costs and daily-limit use."
#property description "A calculator only: it places no orders and gives no signals."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   0

#include "AT24_TP_Core.mqh"

#resource "tp_logo56.bmp"

enum ENUM_AT24TP_RISK { TP_RISK_PCT = 0, TP_RISK_MONEY = 1 };

input group "=== Risk ==="
input ENUM_AT24TP_RISK InpRiskMode = TP_RISK_PCT; // Risk is set as
input double InpRiskPct       = 1.0;    // Risk per trade, % of balance
input double InpRiskMoney     = 100.0;  // Risk per trade, account currency (when set as money)
input double InpCommission    = 0.0;    // Round-turn commission per lot (account currency)
input double InpDailyLossPct  = 5.0;    // Daily loss limit, % of balance (0 = off)
input group "=== Lines ==="
input double InpAtrMult       = 1.5;    // First placement: stop distance in ATR(14) of this timeframe
input double InpRewardRisk    = 2.0;    // First placement: target distance as a multiple of the stop
input bool   InpResetLines    = false;  // Put the lines back at the current price on the next start
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[];
string PFX = "AT24TP_";
string LN_E = "AT24TP_entry", LN_S = "AT24TP_sl", LN_T = "AT24TP_tp";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
AT24TP_Plan gP;
string gMsg = "";
double gMargin = -1.0, gTickValue = 0.0;
bool   gTvFallback = false;

#define DASH_W 380
#define DASH_H 296

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::tp_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

double LineVal(const string n) { return ObjectFind(0, n) >= 0 ? ObjectGetDouble(0, n, OBJPROP_PRICE) : 0.0; }

void MakeLine(const string n, const double price, const color c, const string txt)
  {
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_HLINE, 0, 0, price);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, true);
      ObjectSetInteger(0, n, OBJPROP_SELECTED, true);
      ObjectSetInteger(0, n, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, n, OBJPROP_STYLE, STYLE_DASH);
      ObjectSetInteger(0, n, OBJPROP_COLOR, c);
     }
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
  }

double AtrNow()
  {
   MqlRates r[]; int n = CopyRates(_Symbol, _Period, 1, 60, r);
   if(n < 20) return 0.0;
   double sum = 0.0; int cnt = 0;
   for(int i = n - 14; i < n; i++) { double tr = MathMax(r[i].high - r[i].low, MathMax(MathAbs(r[i].high - r[i - 1].close), MathAbs(r[i].low - r[i - 1].close))); sum += tr; cnt++; }
   return cnt > 0 ? sum / cnt : 0.0;
  }

void PlaceLines()
  {
   double px = SymbolInfoDouble(_Symbol, SYMBOL_BID); if(px <= 0.0) { MqlRates r[]; if(CopyRates(_Symbol, _Period, 0, 1, r) == 1) px = r[0].close; }
   double atr = AtrNow(); if(atr <= 0.0) atr = px * 0.002;
   double d = MathMax(InpAtrMult * atr, 10 * _Point);
   MakeLine(LN_E, px, clrWhite, "ENTRY");
   MakeLine(LN_S, px - d, clrTomato, "STOP");
   MakeLine(LN_T, px + d * InpRewardRisk, clrLimeGreen, "TARGET");
  }

double TodayClosedPL()
  {
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt); dt.hour = 0; dt.min = 0; dt.sec = 0;
   if(!HistorySelect(StructToTime(dt), TimeCurrent() + 86400)) return 0.0;
   double pl = 0.0;
   for(int i = 0; i < HistoryDealsTotal(); i++)
     {
      ulong tk = HistoryDealGetTicket(i); if(tk == 0) continue;
      long e = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(e == DEAL_ENTRY_OUT || e == DEAL_ENTRY_OUT_BY || e == DEAL_ENTRY_INOUT) pl += HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP);
     }
   return pl;
  }

void Recompute()
  {
   double entry = LineVal(LN_E), sl = LineVal(LN_S), tp = LineVal(LN_T);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   gTvFallback = false;
   if(tv <= 0.0 && AccountInfoString(ACCOUNT_CURRENCY) == SymbolInfoString(_Symbol, SYMBOL_CURRENCY_PROFIT)) { tv = ts * SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE); gTvFallback = true; }
   gTickValue = tv; gMsg = "";
   if(entry <= 0.0 || sl <= 0.0 || tp <= 0.0 || ts <= 0.0 || tv <= 0.0) { gP.dir = 0; gP.linesOk = false; gMsg = tv <= 0.0 ? "NO QUOTE / CONVERSION DATA YET" : "PLACE ENTRY, STOP, TARGET"; return; }
   double risk = (InpRiskMode == TP_RISK_PCT) ? bal * InpRiskPct / 100.0 : InpRiskMoney;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double spr = (ask > 0.0 && bid > 0.0) ? ask - bid : 0.0;
   double allow = InpDailyLossPct > 0.0 ? MathMax(bal * InpDailyLossPct / 100.0 + TodayClosedPL(), 0.0) : 0.0;
   AT24TP_Plan_Calc(entry, sl, tp, risk, ts, tv, SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), spr, InpCommission, allow, gP);
   gMargin = -1.0;
   if(gP.lots > 0.0)
     {
      double m = 0.0; ENUM_ORDER_TYPE ot = gP.dir > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(OrderCalcMargin(ot, _Symbol, gP.lots, entry, m) && m > 0.0) gMargin = m;
     }
   long lvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   if(!gP.linesOk) gMsg = "CHECK LINES: stop and target must be on opposite sides of entry";
   else if(gP.tooSmall) gMsg = "RISK TOO SMALL: even the minimum lot risks more";
   else if(gP.capped) gMsg = "LOTS CAPPED at the maximum volume";
   else if(lvl > 0 && gP.slDist < lvl * _Point) gMsg = "STOP is closer than the broker minimum distance";
   ObjectSetString(0, LN_E, OBJPROP_TEXT, gP.linesOk ? StringFormat("ENTRY %s %.2f lots", gP.dir > 0 ? "LONG" : "SHORT", gP.lots) : "ENTRY");
   ObjectSetString(0, LN_S, OBJPROP_TEXT, gP.linesOk ? StringFormat("STOP -%.2f", gP.riskMoney) : "STOP");
   ObjectSetString(0, LN_T, OBJPROP_TEXT, gP.linesOk ? StringFormat("TARGET +%.2f  (R:R %.2f)", gP.rewardMoney, gP.rr) : "TARGET");
   B0[0] = gP.lots; B1[0] = gP.riskMoney; B2[0] = gP.rr;
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   MakeLabel("t1", 70, 6, "AT24 TRADE PLANNER", C'230,190,80', 10, true);
   if(!gP.linesOk)
     {
      MakeLabel("t2", 70, 26, gMsg == "" ? "DRAG THE LINES" : gMsg, clrTomato, 9, true);
      MakeLabel("t3", 70, 42, "Entry (white), Stop (red), Target (green)", clrSilver, 8);
      for(int k = 0; k < 14; k++) MakeLabel("r" + IntegerToString(k), 10, 70 + k * 14, " ", clrWhite, 8);
      return;
     }
   MakeLabel("t2", 70, 26, StringFormat("%s  %.2f lots", gP.dir > 0 ? "LONG" : "SHORT", gP.lots), gP.dir > 0 ? clrLimeGreen : clrTomato, 12, true);
   MakeLabel("t3", 70, 42, StringFormat("R:R %.2f   stop %.2f   target %.2f", gP.rr, gP.slDist, gP.tpDist), clrWhite, 8, true);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   MakeLabel("r0", 10, 70, "Money", C'230,190,80', 8, true);
   MakeLabel("r1", 10, 84, StringFormat("risk at stop   -%.2f %s  (%.2f %% of balance)", gP.riskMoney, cur, bal > 0 ? 100.0 * gP.riskMoney / bal : 0.0), clrWhite, 8);
   MakeLabel("r2", 10, 98, StringFormat("reward at target   +%.2f %s", gP.rewardMoney, cur), clrWhite, 8);
   MakeLabel("r3", 10, 112, gMargin >= 0 ? StringFormat("margin needed   %.2f %s  (%.1f %% of free margin)", gMargin, cur, AccountInfoDouble(ACCOUNT_MARGIN_FREE) > 0 ? 100.0 * gMargin / AccountInfoDouble(ACCOUNT_MARGIN_FREE) : 0.0) : "margin needed   n/a (no quote data)", clrWhite, 8);
   MakeLabel("r4", 10, 136, "Costs", C'230,190,80', 8, true);
   MakeLabel("r5", 10, 150, StringFormat("spread %.2f + commission %.2f %s = %.1f %% of the reward", gP.spreadCost, gP.commission, cur, gP.costShare), gP.costShare > 25.0 ? clrTomato : clrWhite, 8);
   MakeLabel("r6", 10, 174, "Daily limit", C'230,190,80', 8, true);
   if(InpDailyLossPct > 0.0) MakeLabel("r7", 10, 188, gP.dailyShare > 0.0 ? StringFormat("this trade uses %.0f %% of today's remaining loss allowance", gP.dailyShare) : "no loss allowance left today", gP.dailyShare >= 50.0 || gP.dailyShare == 0.0 ? clrTomato : clrWhite, 8);
   else MakeLabel("r7", 10, 188, "daily limit check is off", clrSlateGray, 8);
   MakeLabel("r8", 10, 212, gMsg == "" ? "Lines OK." : gMsg, gMsg == "" ? clrSlateGray : clrTomato, 8, gMsg != "");
   MakeLabel("n1", 10, 236, "Planning calculator: it places no orders. Costs use the", clrSlateGray, 7);
   MakeLabel("n2", 10, 247, gTvFallback ? "contract size (no live conversion rate). Check the numbers." : "current spread; slippage and gaps are not included.", clrSlateGray, 7);
   MakeLabel("f1", 10, 270, "Not a signal or advice. algotraders24.ai", clrSlateGray, 7);
   for(int k = 9; k < 14; k++) MakeLabel("r" + IntegerToString(k), 10, 70 + k * 14, " ", clrWhite, 8);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Trade Planner");
   if(InpRiskPct <= 0.0 || InpRiskPct > 20.0 || InpRiskMoney <= 0.0 || InpCommission < 0.0 || InpDailyLossPct < 0.0 || InpDailyLossPct > 50.0 || InpAtrMult <= 0.0 || InpRewardRisk <= 0.0)
     {
      Print("AT24 Trade Planner: risk 0-20 %, risk money > 0, commission >= 0, daily limit 0-50 %, ATR multiple > 0, reward:risk > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   if(InpResetLines) { ObjectDelete(0, LN_E); ObjectDelete(0, LN_S); ObjectDelete(0, LN_T); }
   if(!tester) PlaceLines();
   gP.linesOk = false; gP.dir = 0;
   EventSetTimer(2);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id == CHARTEVENT_CHART_CHANGE && gDash) BuildFrame();
   if(id == CHARTEVENT_OBJECT_DRAG || id == CHARTEVENT_OBJECT_CHANGE) { Recompute(); Draw(); ChartRedraw(0); }
  }

void OnDeinit(const int reason)
  {
   EventKillTimer(); ObjectsDeleteAll(0, PFX);
   if(reason == REASON_REMOVE) { ObjectDelete(0, LN_E); ObjectDelete(0, LN_S); ObjectDelete(0, LN_T); }
  }

void OnTimer() { Recompute(); Draw(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 2) return 0;
   Recompute();
   Draw();
   return rates_total;
  }
