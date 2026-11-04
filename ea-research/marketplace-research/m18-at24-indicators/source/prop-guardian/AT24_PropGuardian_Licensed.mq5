//+------------------------------------------------------------------+
//| AT24 Prop Guardian (MT5)                                         |
//| Stops you before the limit stops your account.                   |
//| Closes all trades when your daily / max loss limit is near,      |
//| blocks new trades while locked, optional profit lock.            |
//| It places NO trades of its own. Protection tool, not a           |
//| guarantee. Not affiliated with any prop firm.                    |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.01"
#property description "AT24 Prop Guardian - enforces YOUR daily loss, max loss and profit-lock limits."
#property description "Keep it running 24/5 (VPS). Gaps, slippage or a stopped EA can still cause losses beyond a limit."

//--- AT24 licence gate: one key = one trading account, only for this product (the Strategy Tester needs no key)
#define AT24_PRODUCT_ID "AT24-PROP-GUARDIAN"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = "";   // AT24 licence key (from your AT24 purchase page)

#include <Trade\Trade.mqh>
#include "AT24_PropGuard_Core.mqh"

#resource "gd_logo56.bmp"

enum ENUM_AT24GD_BASIS
  {
   GD_START_BALANCE = 0,  // Day start = balance at reset (rebuilt from history)
   GD_START_EQUITY  = 1   // Day start = equity when first seen after reset
  };

input group "=== Your limits ==="
input double InpInitialBalance = 0;      // Initial balance / account size (0 = balance when first started)
input double InpDailyLossPct   = 5.0;    // Daily loss limit, % of day-start value
input double InpMaxLossPct     = 10.0;   // Max total loss limit, % of initial balance
input double InpActAtPct       = 90.0;   // ACT when this % of a loss limit is used (buffer for slippage)
input double InpProfitLockPct  = 0.0;    // Daily profit lock, % of day-start value (0 = off)
input group "=== What it protects ==="
input long   InpMagic          = 0;      // Only manage this magic number (0 = every position on the account)
input bool   InpBlockNew       = true;   // While locked, close any new position and delete new pending orders
input int    InpMaxBlocks      = 5;      // Runaway alert: another EA re-opened this many trades during one lock (0 = off)
input bool   InpStopAtLimit    = false;  // After that limit stop closing re-opened trades (alert only). Default: keep closing
input int    InpDeviation      = 50;     // Max slippage (points) when closing
input group "=== Day definition ==="
input int    InpResetHour      = 0;      // Daily reset hour (broker server time)
input ENUM_AT24GD_BASIS InpBasis = GD_START_BALANCE; // How the day start is measured
input group "=== Dashboard ==="
input bool   InpShowDash       = true;   // Show dashboard
input bool   InpDashInTester   = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX          = 12;     // Dashboard X offset
input int    InpDashY          = 24;     // Dashboard Y offset
input group "=== Alerts ==="
input bool   InpAlert          = true;   // Alert when it locks the account
input bool   InpAlertPush      = false;  // Also send push notification
input group "=== Strategy Tester self-test (tester only, never trades live) ==="
input bool   InpSelfTest       = false;  // Tester: open test trades to prove the lock works
input double InpTestLots       = 1.0;    // Tester: lots per test trade

enum { LK_NONE = 0, LK_DAILY = 1, LK_TOTAL = 2, LK_PROFIT = 3 };

CTrade trade;
string PFX = "AT24GD_";
bool   gDash = false, gTester = false;
int    gBaseX = 0, gBaseY = 0;
int    gLock = LK_NONE, gLockKey = 0;
datetime gLockTime = 0;
int    gClosedAtLock = 0, gBlocked = 0, gLocksToday = 0, gLockBlocks = 0;
bool   gRunaway = false;
int    gTRunaways = 0;
string gLastAction = "none yet";
datetime gLastHist = 0; double gHistSum = 0.0; int gHistKey = 0;
double gMaxDailyUsed = 0.0, gMaxTotalUsed = 0.0;   // highest values seen (for the self-test)
// self-test bookkeeping
int    gTLocks = 0, gTUnlocks = 0, gTBlockedOpens = 0, gTOpens = 0, gTDir = 0;
datetime gTNextOpen = 0;
double gLossAtLock[8]; int gLossN = 0;

#define DASH_W 330
#define DASH_H 270
#define GAUGE_W 310

string GV(const string k) { return "AT24GD_" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + k; }
string Money(const double v) { return StringFormat("%s%s %s", v < 0 ? "-" : "", DoubleToString(MathAbs(v), 2), AccountInfoString(ACCOUNT_CURRENCY)); }

color StatusColor(const int s)
  {
   switch(s) { case 1: return clrLimeGreen; case 2: return clrGold; case 3: return clrOrange; case 4: return clrTomato; }
   return clrSlateGray;
  }

//--- which positions/orders does the guardian manage?
bool Managed(const long magic) { return (InpMagic == 0 || magic == InpMagic); }

void SaveLock()
  {
   GlobalVariableSet(GV("lt"), gLock);
   GlobalVariableSet(GV("lk"), gLockKey);
  }

void LoadLock()
  {
   gLock = GlobalVariableCheck(GV("lt")) ? (int)GlobalVariableGet(GV("lt")) : LK_NONE;
   gLockKey = GlobalVariableCheck(GV("lk")) ? (int)GlobalVariableGet(GV("lk")) : 0;
  }

//--- close every managed position and delete every managed pending order; returns how many were removed
int CloseEverything()
  {
   trade.SetDeviationInPoints(InpDeviation);
   int removed = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || !Managed(PositionGetInteger(POSITION_MAGIC))) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      trade.SetTypeFillingBySymbol(sym);
      if(trade.PositionClose(tk)) removed++;
      else PrintFormat("AT24 Prop Guardian: close #%I64u failed, retcode %u (%s) - will retry", tk, trade.ResultRetcode(), trade.ResultRetcodeDescription());
     }
   for(int j = OrdersTotal() - 1; j >= 0; j--)
     {
      ulong ot = OrderGetTicket(j);
      if(ot == 0 || !Managed(OrderGetInteger(ORDER_MAGIC))) continue;
      if(trade.OrderDelete(ot)) removed++;
     }
   return removed;
  }

int CountManaged()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) { ulong tk = PositionGetTicket(i); if(tk != 0 && Managed(PositionGetInteger(POSITION_MAGIC))) n++; }
   for(int j = OrdersTotal() - 1; j >= 0; j--) { ulong ot = OrderGetTicket(j); if(ot != 0 && Managed(OrderGetInteger(ORDER_MAGIC))) n++; }
   return n;
  }

string LockName(const int t)
  {
   switch(t) { case LK_DAILY: return "daily loss"; case LK_TOTAL: return "max loss"; case LK_PROFIT: return "profit lock"; }
   return "none";
  }

void DoLock(const int type, const double dailyUsed, const double totalUsed, const double equity)
  {
   gLock = type;
   gLockKey = AT24PG_DayKey(TimeCurrent(), InpResetHour);
   gLockTime = TimeCurrent();
   SaveLock();
   gLocksToday++;
   gLockBlocks = 0; gRunaway = false;
   int n = CloseEverything();
   gClosedAtLock = n;
   gLastAction = StringFormat("%s %s: closed %d, daily %.0f%% / total %.0f%%", TimeToString(TimeCurrent(), TIME_MINUTES), LockName(type), n, dailyUsed * 100.0, totalUsed * 100.0);
   string msg = StringFormat("AT24 Prop Guardian LOCKED (%s): closed %d positions/orders. Daily used %.0f%%, total used %.0f%%, equity %.2f", LockName(type), n, dailyUsed * 100.0, totalUsed * 100.0, equity);
   Print(msg);
   if(InpAlert && !gTester) { Alert(msg); if(InpAlertPush) SendNotification(msg); }
   if(gTester) { gTLocks++; if(gLossN < 8) { gLossAtLock[gLossN] = MathMax(dailyUsed, totalUsed); gLossN++; } }
  }

void Unlock(const string why)
  {
   if(gLock == LK_NONE) return;
   gLastAction = StringFormat("%s unlocked (%s)", TimeToString(TimeCurrent(), TIME_MINUTES), why);
   Print("AT24 Prop Guardian: ", gLastAction);
   gLock = LK_NONE; gLockKey = 0;
   gLockBlocks = 0; gRunaway = false;
   SaveLock();
   if(gTester) gTUnlocks++;
  }

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

void MakeRect(const string name, const int x, const int y, const int w, const int h, const color bg)
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
   ObjectSetInteger(0, n, OBJPROP_COLOR, bg);
  }

void DrawDash(const double dailyUsed, const double totalUsed, const double dailyLeft, const double totalLeft, const double dayBase, const double pnl)
  {
   if(!gDash) return;
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40');
   ObjectSetInteger(0, PFX + "bg", OBJPROP_COLOR, C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::gd_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);

   bool locked = (gLock != LK_NONE);
   MakeLabel("t1", 70, 6, "AT24 PROP GUARDIAN", C'230,190,80', 10, true);
   MakeLabel("t2", 70, 26, locked ? "LOCKED - " + LockName(gLock) : "ARMED - watching your limits", locked ? clrTomato : clrLimeGreen, 11, true);

   MakeLabel("l1", 10, 66, StringFormat("Daily loss   %.0f%% used   (acts at %.0f%%)", MathMin(dailyUsed, 9.99) * 100.0, InpActAtPct), clrWhite, 9);
   MakeRect("g1bg", 10, 84, GAUGE_W, 10, C'30,44,66');
   MakeRect("g1", 10, 84, (int)(GAUGE_W * MathMin(1.0, dailyUsed)), 10, StatusColor(AT24PG_Status(dailyUsed)));
   MakeLabel("l2", 10, 100, StringFormat("Total loss   %.0f%% used   (acts at %.0f%%)", MathMin(totalUsed, 9.99) * 100.0, InpActAtPct), clrWhite, 9);
   MakeRect("g2bg", 10, 118, GAUGE_W, 10, C'30,44,66');
   MakeRect("g2", 10, 118, (int)(GAUGE_W * MathMin(1.0, totalUsed)), 10, StatusColor(AT24PG_Status(totalUsed)));

   MakeLabel("l3", 10, 136, "Left today  " + Money(dailyLeft) + "     overall  " + Money(totalLeft), dailyLeft <= 0 || totalLeft <= 0 ? clrTomato : clrWhite, 9);
   MakeLabel("l4", 10, 152, StringFormat("Day P/L  %s   (day start %s)", Money(pnl), Money(dayBase)), pnl < 0 ? clrOrange : clrWhite, 9);
   MakeLabel("l5", 10, 168, StringFormat("Managing: %s   Profit lock: %s", InpMagic == 0 ? "all positions" : "magic " + IntegerToString(InpMagic), InpProfitLockPct > 0 ? StringFormat("%.1f%%", InpProfitLockPct) : "off"), clrSlateGray, 8);
   MakeLabel("l6", 10, 184, "Last action: " + gLastAction, clrGold, 8);
   if(gRunaway) MakeLabel("l7", 10, 200, StringFormat("RUNAWAY: %d trades re-opened while locked - stop that EA!", gLockBlocks), clrTomato, 8, true);
   else MakeLabel("l7", 10, 200, StringFormat("Blocked new trades while locked: %d", gBlocked), clrSlateGray, 8);

   //--- unlock button (only while locked)
   string bn = PFX + "btn";
   if(locked)
     {
      if(ObjectFind(0, bn) < 0)
        {
         ObjectCreate(0, bn, OBJ_BUTTON, 0, 0, 0);
         ObjectSetInteger(0, bn, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, bn, OBJPROP_HIDDEN, true);
         ObjectSetString(0, bn, OBJPROP_TEXT, "UNLOCK");
         ObjectSetInteger(0, bn, OBJPROP_BGCOLOR, C'60,30,30');
         ObjectSetInteger(0, bn, OBJPROP_COLOR, clrWhite);
         ObjectSetInteger(0, bn, OBJPROP_FONTSIZE, 8);
        }
      ObjectSetInteger(0, bn, OBJPROP_XDISTANCE, gBaseX + 240);
      ObjectSetInteger(0, bn, OBJPROP_YDISTANCE, gBaseY + 214);
      ObjectSetInteger(0, bn, OBJPROP_XSIZE, 80);
      ObjectSetInteger(0, bn, OBJPROP_YSIZE, 20);
     }
   else ObjectDelete(0, bn);
   MakeLabel("l8", 10, 218, locked ? (gLock == LK_TOTAL ? "Stays locked until you press UNLOCK." : "Unlocks by itself at the next daily reset.") : "No new trades are blocked while armed.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Protection tool, not a guarantee: gaps, slippage and a", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "stopped EA can still cause losses. Not affiliated with any firm. algotraders24.ai", clrSlateGray, 7);
  }

void Evaluate()
  {
   if(!AT24Gate_Allowed()) return;                          // no valid licence: the guardian is OFF (the gate says why)
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   if(AccountInfoInteger(ACCOUNT_LOGIN) == 0 || balance <= 0.0) return;   // never act on missing account data
   datetime now = TimeCurrent();
   int key = AT24PG_DayKey(now, InpResetHour);

   double initial = InpInitialBalance;
   if(initial <= 0.0)
     {
      if(!GlobalVariableCheck(GV("init"))) GlobalVariableSet(GV("init"), balance);
      initial = GlobalVariableGet(GV("init"));
     }

   double dayBase;
   if(InpBasis == GD_START_BALANCE)
     {
      if(key != gHistKey || now - gLastHist >= 5)
        { gHistSum = DealsSince(AT24PG_DayStart(now, InpResetHour)); gHistKey = key; gLastHist = now; }
      dayBase = balance - gHistSum;
     }
   else
     {
      if(!GlobalVariableCheck(GV("dk")) || (int)GlobalVariableGet(GV("dk")) != key)
        { GlobalVariableSet(GV("dk"), key); GlobalVariableSet(GV("ds"), equity); }
      dayBase = GlobalVariableGet(GV("ds"));
     }

   double o[];
   AT24PG_Calc(dayBase, equity, initial, InpDailyLossPct, InpMaxLossPct, 0.0, o);
   double act = InpActAtPct / 100.0;
   gMaxDailyUsed = MathMax(gMaxDailyUsed, o[3]);
   gMaxTotalUsed = MathMax(gMaxTotalUsed, o[6]);

   //--- daily / profit locks expire at the next reset
   if((gLock == LK_DAILY || gLock == LK_PROFIT) && gLockKey != key) Unlock("new trading day");

   if(gLock == LK_NONE)
     {
      if(o[6] >= act)                                                   DoLock(LK_TOTAL, o[3], o[6], equity);
      else if(o[3] >= act)                                              DoLock(LK_DAILY, o[3], o[6], equity);
      else if(InpProfitLockPct > 0.0 && o[1] >= dayBase * InpProfitLockPct / 100.0) DoLock(LK_PROFIT, o[3], o[6], equity);
     }
   else if(InpBlockNew || CountManaged() > 0)
     {
      //--- locked: nothing managed may stay open (also retries closes that failed earlier)
      int n = CountManaged();
      bool stop = (InpStopAtLimit && gRunaway);    // runaway EA: leave it alone, only warn
      if(n > 0 && !stop)
        {
         int r = CloseEverything();
         if(InpBlockNew && r > 0)
           {
            gBlocked += r; gLockBlocks += r;
            gLastAction = StringFormat("%s blocked %d new trade(s) while locked", TimeToString(TimeCurrent(), TIME_MINUTES), r);
            if(gTester) gTBlockedOpens += r;
            if(InpMaxBlocks > 0 && !gRunaway && gLockBlocks >= InpMaxBlocks)
              {
               gRunaway = true;
               string rm = StringFormat("AT24 Prop Guardian RUNAWAY: another EA or you re-opened %d trades while the account is locked (%s). Every forced close costs spread. Switch that EA off.%s", gLockBlocks, LockName(gLock), InpStopAtLimit ? " Guardian now stops closing them." : "");
               Print(rm);
               if(!gTester) { Alert(rm); if(InpAlertPush) SendNotification(rm); }
               else gTRunaways++;
              }
           }
        }
     }
   DrawDash(o[3], o[6], o[2], o[5], dayBase, o[1]);
  }

//--- Strategy Tester only: open a test trade now and then so the lock can be proven
void SelfTestStep()
  {
   if(!gTester || !InpSelfTest) return;
   if(TimeCurrent() < gTNextOpen) return;
   gTNextOpen = TimeCurrent() + 600;     // one attempt every 10 minutes
   if(CountManaged() > 0 && gLock == LK_NONE) return;     // already in a test trade
   gTDir = 1 - gTDir;
   trade.SetDeviationInPoints(InpDeviation);
   bool ok = (gTDir == 0) ? trade.Buy(InpTestLots, _Symbol) : trade.Sell(InpTestLots, _Symbol);
   if(ok) { gTOpens++; if(gLock != LK_NONE) { /* opened while locked: the guardian must remove it */ } }
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   if(InpDailyLossPct <= 0 || InpMaxLossPct <= 0 || InpActAtPct <= 0 || InpActAtPct > 100 || InpResetHour < 0 || InpResetHour > 23 || InpProfitLockPct < 0)
     {
      Print("AT24 Prop Guardian: invalid inputs (limits above 0, act % between 0 and 100, reset hour 0-23).");
      return INIT_PARAMETERS_INCORRECT;
     }
   gTester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!gTester || (InpDashInTester && visual));
   if(gTester) { GlobalVariableDel(GV("lt")); GlobalVariableDel(GV("lk")); GlobalVariableDel(GV("init")); GlobalVariableDel(GV("dk")); GlobalVariableDel(GV("ds")); }
   LoadLock();
   if(gLock != LK_NONE) PrintFormat("AT24 Prop Guardian: restored lock (%s) from a previous session.", LockName(gLock));
   EventSetTimer(1);
   Print("AT24 Prop Guardian armed. It closes trades at ", DoubleToString(InpActAtPct, 0), "% of your daily (", DoubleToString(InpDailyLossPct, 1), "%) / max (", DoubleToString(InpMaxLossPct, 1), "%) loss limit.");
   return INIT_SUCCEEDED;
  }

void OnTimer() { AT24Gate_Timer(InpLicenseKey); if(!gTester) Evaluate(); }

void OnTick()
  {
   Evaluate();
   SelfTestStep();
  }

void OnTrade() { Evaluate(); }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) { CalcBase(); }
   if(id == CHARTEVENT_OBJECT_CLICK && sparam == PFX + "btn")
     {
      ObjectSetInteger(0, PFX + "btn", OBJPROP_STATE, false);
      string txt = (gLock == LK_TOTAL)
                   ? "Unlock after a MAX LOSS lock?\nOnly do this for a new account / new challenge. If InpInitialBalance is 0 the stored initial balance is reset to the current balance."
                   : "Unlock now?\nIf your loss is still above the limit the guardian will lock again immediately.";
      if(MessageBox(txt, "AT24 Prop Guardian", MB_YESNO | MB_ICONWARNING) == IDYES)
        {
         if(gLock == LK_TOTAL && InpInitialBalance <= 0.0) GlobalVariableDel(GV("init"));
         Unlock("manual");
        }
     }
  }

void OnDeinit(const int reason)
  {
   if(gTester && InpSelfTest)
     {
      double mx = 0.0; for(int i = 0; i < gLossN; i++) mx = MathMax(mx, gLossAtLock[i]);
      PrintFormat("GDTEST summary opens=%d locks=%d unlocks=%d blockedNewTrades=%d maxDailyUsed=%.1f%% maxTotalUsed=%.1f%% usedAtLockMax=%.1f%% stillOpen=%d runaways=%d",
                  gTOpens, gTLocks, gTUnlocks, gTBlockedOpens, gMaxDailyUsed * 100.0, gMaxTotalUsed * 100.0, mx * 100.0, CountManaged(), gTRunaways);
     }
   SaveLock();
   EventKillTimer();
   ObjectsDeleteAll(0, PFX);
  }
