//+------------------------------------------------------------------+
//|                                          AT24_Account_Guard.mq5  |
//|  AT24 Account Guard - account-level risk lock for MT5            |
//|                                                                  |
//|  Watches ACCOUNT equity and, when a limit is breached, closes    |
//|  positions, deletes pending orders and then keeps closing any    |
//|  new trade (from any EA or by hand) until the lock ends.         |
//|    - daily loss limit        -> locked until the next day        |
//|    - daily profit target     -> locked until the next day        |
//|    - minimum margin level    -> locked until the next day        |
//|    - max drawdown from peak  -> locked until you clear it        |
//|  State survives terminal restarts (global variables).            |
//|  Does not generate trades. It cannot stop an EA from SENDING     |
//|  orders; it closes them within about a second (timer based).     |
//|  Honest limits: a gap or slippage can overshoot a limit; the     |
//|  broker is the final execution authority.                        |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI (AT24)"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "Account-level risk lock: daily loss, profit target, margin level, max drawdown. Closes trades and blocks new ones until the lock ends."
#property strict

#include "../AT24_EA_Core/Include/AT24_EA_Core.mqh"
#include "Include/AT24_Guard_Logic.mqh"

enum ENUM_GUARD_BASE
  {
   BASE_BALANCE = 0,   // Day baseline = balance at day start
   BASE_EQUITY  = 1    // Day baseline = equity at day start
  };

input group "=== LIMITS (0 = off) ==="
input double          InpDailyLossPct      = 4.0;   // Daily loss limit (% of day baseline)
input double          InpMaxDrawdownPct    = 8.0;   // Max drawdown from peak equity (%)
input double          InpDailyProfitPct    = 0.0;   // Daily profit target (% of day baseline)
input double          InpMinMarginLevel    = 0.0;   // Minimum margin level (%) while positions are open
input ENUM_GUARD_BASE InpDayBase           = BASE_BALANCE; // Day baseline
input int             InpResetHour         = 0;     // Server hour at which a new day starts (0-23)

input group "=== SCOPE ==="
input bool            InpAllSymbols        = true;  // Guard every symbol (false = chart symbol only)
input long            InpMagicFilter       = -1;    // Only this magic number (-1 = all trades, incl. manual)

input group "=== ACTIONS ==="
input bool            InpDryRun            = false; // true = only alert, never close anything
input bool            InpCloseOnBreach     = true;  // Close open positions on breach
input bool            InpDeletePending     = true;  // Delete pending orders on breach and during lock
input bool            InpBlockDuringLock   = true;  // Keep closing any new trade while locked
input bool            InpClearLockOnStart  = false; // Set true for ONE start to clear a max-drawdown lock and reset the peak
input bool            InpAlertPopup        = true;  // Popup alert on breach
input bool            InpAlertPush         = false; // Push notification on breach

//--- global-variable state (restart-safe)
string g_prefix;
double g_dayBase = 0.0, g_peak = 0.0, g_lockType = 0.0;   // lockType: 0 none, 1 daily, 2 permanent
double g_dayKey = 0.0, g_lockDay = 0.0;
string g_lastBreach = "";
SGuardLimits g_lim;

string GV(const string n) { return g_prefix + n; }

void SaveState()
  {
   GlobalVariableSet(GV("dayBase"), g_dayBase);
   GlobalVariableSet(GV("peak"), g_peak);
   GlobalVariableSet(GV("lockType"), g_lockType);
   GlobalVariableSet(GV("dayKey"), g_dayKey);
   GlobalVariableSet(GV("lockDay"), g_lockDay);
  }

double LoadGV(const string n, const double def)
  {
   return GlobalVariableCheck(GV(n)) ? GlobalVariableGet(GV(n)) : def;
  }

//--- day identifier in server time, shifted by the reset hour
double CurrentDayKey()
  {
   MqlDateTime d;
   TimeToStruct(TimeCurrent() - (datetime)(InpResetHour * 3600), d);
   return d.year * 10000.0 + d.mon * 100.0 + d.day;
  }

double DayBaseNow()
  {
   return (InpDayBase == BASE_BALANCE) ? AccountInfoDouble(ACCOUNT_BALANCE) : AccountInfoDouble(ACCOUNT_EQUITY);
  }

bool InScopePosition()
  {
   if(!InpAllSymbols && PositionGetString(POSITION_SYMBOL) != _Symbol)
      return false;
   if(InpMagicFilter >= 0 && PositionGetInteger(POSITION_MAGIC) != InpMagicFilter)
      return false;
   return true;
  }

int CountScopePositions()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(InScopePosition()) n++;
     }
   return n;
  }

//--- Close every in-scope position (through the shared execution layer). Returns how many remain.
int CloseAllScope()
  {
   SAT24ExecConfig cfg;
   cfg.Defaults();
   cfg.deviation_points = 200;     // exiting matters more than price
   cfg.max_retries = 3;
   cfg.verbose = true;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !InScopePosition()) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      cfg.magic = (ulong)PositionGetInteger(POSITION_MAGIC);
      CAT24Exec ex;
      ex.Init(sym, cfg);
      SAT24ExecResult r;
      ex.Close(ticket, 0.0, r);
     }
   return CountScopePositions();
  }

void DeleteScopePending()
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(!InpAllSymbols && OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      if(InpMagicFilter >= 0 && OrderGetInteger(ORDER_MAGIC) != InpMagicFilter) continue;
      MqlTradeRequest req;
      MqlTradeResult res;
      ZeroMemory(req);
      ZeroMemory(res);
      req.action = TRADE_ACTION_REMOVE;
      req.order  = ticket;
      if(!OrderSend(req, res))
         PrintFormat("[AT24-GUARD] could not delete pending #%I64u retcode=%u", ticket, res.retcode);
     }
  }

void Notify(const string msg)
  {
   Print("[AT24-GUARD] ", msg);
   if(InpAlertPopup) Alert("AT24 Account Guard: ", msg);
   if(InpAlertPush)  SendNotification("AT24 Account Guard: " + msg);
  }

void RollDayIfNeeded()
  {
   double key = CurrentDayKey();
   if(key == g_dayKey) return;
   g_dayKey = key;
   g_dayBase = DayBaseNow();
   if(g_lockType == 1.0)
     {
      g_lockType = 0.0;
      Notify("new day: daily lock released");
     }
   SaveState();
  }

void ShowPanel(const double equity)
  {
   double loss = (g_dayBase > 0.0) ? (g_dayBase - equity) / g_dayBase * 100.0 : 0.0;
   double dd   = (g_peak > 0.0) ? (g_peak - equity) / g_peak * 100.0 : 0.0;
   string lock = (g_lockType == 0.0) ? "ACTIVE (watching)" : (g_lockType == 1.0 ? "LOCKED until next day" : "LOCKED until you clear it");
   Comment("AT24 Account Guard  v1.00\n",
           "Status: ", lock, InpDryRun ? "  [DRY RUN]" : "", "\n",
           StringFormat("Equity %.2f | day baseline %.2f | peak %.2f\n", equity, g_dayBase, g_peak),
           StringFormat("Day P/L %.2f%% (limit -%.1f%%, target +%.1f%%)\n", -loss, g_lim.daily_loss_pct, g_lim.daily_profit_pct),
           StringFormat("Drawdown from peak %.2f%% (limit %.1f%%)\n", dd, g_lim.max_drawdown_pct),
           g_lastBreach == "" ? "" : "Last breach: " + g_lastBreach);
  }

void Evaluate()
  {
   RollDayIfNeeded();
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity > g_peak) { g_peak = equity; SaveState(); }

   if(g_lockType != 0.0)
     {
      if(InpBlockDuringLock && !InpDryRun)
        {
         if(CountScopePositions() > 0) CloseAllScope();
         if(InpDeletePending) DeleteScopePending();
        }
      ShowPanel(equity);
      return;
     }

   SGuardState st;
   st.day_base = g_dayBase;
   st.peak_equity = g_peak;
   ENUM_GUARD_BREACH b = Guard_Evaluate(g_lim, st, equity, AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), CountScopePositions() > 0);
   if(b != GUARD_OK)
     {
      g_lastBreach = Guard_Text(b) + " at " + TimeToString(TimeCurrent());
      Notify(StringFormat("%s breached (equity %.2f)%s", Guard_Text(b), equity, InpDryRun ? " - DRY RUN, nothing closed" : ""));
      if(!InpDryRun)
        {
         g_lockType = Guard_IsPermanent(b) ? 2.0 : 1.0;
         g_lockDay = g_dayKey;
         SaveState();
         if(InpCloseOnBreach) CloseAllScope();
         if(InpDeletePending) DeleteScopePending();
        }
     }
   ShowPanel(equity);
  }

int OnInit()
  {
   g_prefix = StringFormat("AT24G_%I64d_", AccountInfoInteger(ACCOUNT_LOGIN));
   g_lim.daily_loss_pct = InpDailyLossPct;
   g_lim.max_drawdown_pct = InpMaxDrawdownPct;
   g_lim.daily_profit_pct = InpDailyProfitPct;
   g_lim.min_margin_level_pct = InpMinMarginLevel;
   if(InpResetHour < 0 || InpResetHour > 23)
     { Print("[AT24-GUARD] InpResetHour must be 0-23"); return INIT_PARAMETERS_INCORRECT; }
   if(InpDailyLossPct < 0 || InpMaxDrawdownPct < 0 || InpDailyProfitPct < 0 || InpMinMarginLevel < 0)
     { Print("[AT24-GUARD] limits cannot be negative"); return INIT_PARAMETERS_INCORRECT; }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED) && !InpDryRun)
      Print("[AT24-GUARD] WARNING: algo trading is OFF for this EA; it cannot close trades until you enable it.");

   g_dayKey   = LoadGV("dayKey", 0.0);
   g_dayBase  = LoadGV("dayBase", 0.0);
   g_peak     = LoadGV("peak", 0.0);
   g_lockType = LoadGV("lockType", 0.0);
   g_lockDay  = LoadGV("lockDay", 0.0);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_peak <= 0.0) g_peak = equity;
   if(g_dayBase <= 0.0) { g_dayBase = DayBaseNow(); g_dayKey = CurrentDayKey(); }
   if(InpClearLockOnStart)
     {
      g_lockType = 0.0;
      g_peak = equity;
      Notify("lock cleared and peak reset by InpClearLockOnStart (set it back to false)");
     }
   SaveState();
   PrintFormat("[AT24-GUARD] started on account %I64d | loss %.1f%% | maxDD %.1f%% | profit target %.1f%% | margin>= %.0f%% | scope %s | %s",
               AccountInfoInteger(ACCOUNT_LOGIN), InpDailyLossPct, InpMaxDrawdownPct, InpDailyProfitPct, InpMinMarginLevel,
               InpAllSymbols ? "all symbols" : _Symbol, InpDryRun ? "DRY RUN" : "LIVE");
   EventSetTimer(1);
   Evaluate();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer() { Evaluate(); }
void OnTick()  { Evaluate(); }
