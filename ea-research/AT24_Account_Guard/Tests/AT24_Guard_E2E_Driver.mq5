//+------------------------------------------------------------------+
//| AT24_Guard_E2E_Driver.mq5  (test tool, DEMO accounts only)       |
//| Runs next to AT24_Account_Guard (daily loss limit set absurdly   |
//| tight so the first spread tick breaches it) and checks:          |
//|  1 a position opened by this script is closed by the guard       |
//|  2 the lock state is written (survives restart: global vars)     |
//|  3 a NEW position opened during the lock is closed again         |
//|  4 a pending order placed during the lock is deleted             |
//| Result lines go to the Experts log and to                        |
//| <Common>\Files\at24_guard_e2e.txt                                |
//+------------------------------------------------------------------+
#property script_show_inputs
#property version "1.00"
#include "../../AT24_EA_Core/Include/AT24_EA_Core.mqh"

input int InpWaitSeconds = 12;   // max seconds to wait for the guard to react

int g_pass = 0, g_fail = 0;
string g_log = "";

void Check(const string name, const bool ok, const string detail = "")
  {
   if(ok) g_pass++; else g_fail++;
   string line = StringFormat("[GUARD-E2E] %s  %s  %s", ok ? "PASS" : "FAIL", name, detail);
   Print(line);
   g_log += line + "\n";
  }

int MyPositions() { int n = 0; for(int i = PositionsTotal() - 1; i >= 0; i--) if(PositionGetTicket(i) != 0 && PositionGetInteger(POSITION_MAGIC) == 555) n++; return n; }
int MyPendings()  { int n = 0; for(int i = OrdersTotal() - 1; i >= 0; i--)   if(OrderGetTicket(i) != 0 && OrderGetInteger(ORDER_MAGIC) == 555) n++; return n; }

bool WaitUntil(const bool wantZeroPositions, const bool wantZeroPendings)
  {
   for(int i = 0; i < InpWaitSeconds * 4; i++)
     {
      if((!wantZeroPositions || MyPositions() == 0) && (!wantZeroPendings || MyPendings() == 0)) return true;
      Sleep(250);
     }
   return false;
  }

void OnStart()
  {
   const string sym = _Symbol;
   const string prefix = StringFormat("AT24G_%I64d_", AccountInfoInteger(ACCOUNT_LOGIN));
   PrintFormat("[GUARD-E2E] account %I64d (%s) server %s symbol %s", AccountInfoInteger(ACCOUNT_LOGIN),
               AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL ? "REAL" : "demo", AccountInfoString(ACCOUNT_SERVER), sym);
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL)
     { Print("[GUARD-E2E] REAL account - aborting."); return; }
   if(!GlobalVariableCheck(prefix + "peak"))
     { Print("[GUARD-E2E] Guard EA state not found - is AT24_Account_Guard attached and running?"); }

   SAT24ExecConfig cfg; cfg.Defaults(); cfg.magic = 555; cfg.verbose = true;
   CAT24Exec ex; ex.Init(sym, cfg);
   const double lot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   SAT24ExecResult r;

   //--- 1 breach -> close
   bool opened = ex.Open(ORDER_TYPE_BUY, lot, 0.0, 0.0, "guard-e2e-1", r);
   Check("test position opened", opened, StringFormat("status=%d rc=%u %s", (int)r.status, r.retcode, r.reason));
   if(opened)
      Check("guard closed the position after the breach", WaitUntil(true, false), StringFormat("positions left=%d", MyPositions()));
   Sleep(1500);
   double lockType = GlobalVariableCheck(prefix + "lockType") ? GlobalVariableGet(prefix + "lockType") : -1.0;
   Check("lock state written (lockType=1 daily)", lockType == 1.0, StringFormat("lockType=%.0f", lockType));
   Check("peak equity persisted", GlobalVariableCheck(prefix + "peak") && GlobalVariableGet(prefix + "peak") > 0.0);

   //--- 3 new trade during lock -> closed again
   bool opened2 = ex.Open(ORDER_TYPE_BUY, lot, 0.0, 0.0, "guard-e2e-2", r);
   Check("second position opened during lock", opened2, StringFormat("status=%d rc=%u", (int)r.status, r.retcode));
   if(opened2)
      Check("guard closed the new trade during the lock", WaitUntil(true, false), StringFormat("positions left=%d", MyPositions()));

   //--- 4 pending order during lock -> deleted
   MqlTick t; SymbolInfoTick(sym, t);
   MqlTradeRequest req; MqlTradeResult res; ZeroMemory(req); ZeroMemory(res);
   req.action = TRADE_ACTION_PENDING; req.symbol = sym; req.volume = lot; req.type = ORDER_TYPE_BUY_LIMIT;
   req.price = AT24_NormalizePrice(sym, t.bid - 500 * SymbolInfoDouble(sym, SYMBOL_POINT) * 10);
   req.magic = 555; req.comment = "guard-e2e-pending"; req.type_filling = ORDER_FILLING_RETURN; req.type_time = ORDER_TIME_GTC;
   bool placed = OrderSend(req, res) && (res.retcode == TRADE_RETCODE_PLACED || res.retcode == TRADE_RETCODE_DONE);
   Check("pending order placed during lock", placed, StringFormat("rc=%u", res.retcode));
   if(placed)
      Check("guard deleted the pending order", WaitUntil(false, true), StringFormat("pendings left=%d", MyPendings()));

   //--- cleanup so this account is left clean
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderGetTicket(i) != 0 && OrderGetInteger(ORDER_MAGIC) == 555)
        { MqlTradeRequest q; MqlTradeResult s; ZeroMemory(q); ZeroMemory(s); q.action = TRADE_ACTION_REMOVE; q.order = OrderGetTicket(i); OrderSend(q, s); }
   string keys[] = {"dayBase", "peak", "lockType", "dayKey", "lockDay"};
   for(int k = 0; k < ArraySize(keys); k++) GlobalVariableDel(prefix + keys[k]);

   string summary = StringFormat("[GUARD-E2E] DONE pass=%d fail=%d", g_pass, g_fail);
   Print(summary);
   g_log += summary + "\n";
   int h = FileOpen("at24_guard_e2e.txt", FILE_WRITE | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(h != INVALID_HANDLE) { FileWriteString(h, g_log); FileClose(h); }
  }
