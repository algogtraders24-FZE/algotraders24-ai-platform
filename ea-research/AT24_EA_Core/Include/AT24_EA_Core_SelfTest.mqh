//+------------------------------------------------------------------+
//| AT24_EA_Core_SelfTest.mqh - shared test body for the script and  |
//| the tester EA. Sends NO orders (OrderCheck pre-flight only).     |
//+------------------------------------------------------------------+
#ifndef AT24_EA_CORE_SELFTEST_MQH
#define AT24_EA_CORE_SELFTEST_MQH
#include "AT24_EA_Core.mqh"

int g_pass = 0, g_fail = 0;

void Check(const string name, const bool ok, const string detail = "")
  {
   if(ok) g_pass++; else g_fail++;
   PrintFormat("[SELFTEST] %s  %s  %s", ok ? "PASS" : "FAIL", name, detail);
  }

void AT24_RunSelfTest(const double riskPercent,const double slPoints)
  {
   const string sym = _Symbol;
   PrintFormat("[SELFTEST] AT24_EA_Core %s on %s  account=%I64d  server=%s",
               AT24_CORE_VERSION, sym, AccountInfoInteger(ACCOUNT_LOGIN), AccountInfoString(ACCOUNT_SERVER));
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL)
     { Print("[SELFTEST] REAL account detected - aborting. Use a demo account."); return; }

   //--- fill mode
   ENUM_ORDER_TYPE_FILLING f = AT24_PickFilling(sym);
   long flags = SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
   Check("filling mode picked is allowed by symbol flags",
         (f == ORDER_FILLING_IOC && (flags & SYMBOL_FILLING_IOC) != 0) ||
         (f == ORDER_FILLING_FOK && (flags & SYMBOL_FILLING_FOK) != 0) ||
         f == ORDER_FILLING_RETURN,
         StringFormat("picked=%s flags=%d", EnumToString(f), (int)flags));

   //--- volume normalisation
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vstep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   Check("volume below min -> 0", AT24_NormalizeVolume(sym, vmin / 2.0) == 0.0);
   double v = AT24_NormalizeVolume(sym, vmin + vstep * 1.7);
   Check("volume rounds DOWN to step", MathAbs(v - (vmin + vstep)) < 1e-9, StringFormat("got %.4f", v));
   Check("volume digits sane", AT24_VolumeDigits(sym) >= 0 && AT24_VolumeDigits(sym) <= 8);

   //--- price normalisation
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double p = AT24_NormalizePrice(sym, SymbolInfoDouble(sym, SYMBOL_BID) + ts * 0.3);
   Check("price lands on tick grid", MathAbs(MathRound(p / ts) * ts - p) < ts * 1e-6, StringFormat("p=%.5f ts=%.5f", p, ts));

   //--- stops validation (does not modify inputs)
   MqlTick t; SymbolInfoTick(sym, t);
   double pt = SymbolInfoDouble(sym, SYMBOL_POINT);
   string why;
   Check("BUY with SL above price rejected", !AT24_StopsValid(sym, ORDER_TYPE_BUY, t.ask, t.ask + 100 * pt, 0, why), why);
   Check("SELL with TP above price rejected", !AT24_StopsValid(sym, ORDER_TYPE_SELL, t.bid, 0, t.bid + 100 * pt, why), why);
   Check("BUY with sane SL/TP accepted",
         AT24_StopsValid(sym, ORDER_TYPE_BUY, t.ask, t.ask - slPoints * pt, t.ask + slPoints * 2 * pt, why), why);

   //--- risk lot sizing
   double sl = t.ask - slPoints * pt;
   double lots = AT24_LotForRisk(sym, ORDER_TYPE_BUY, riskPercent, t.ask, sl);
   double profit = 0;
   if(lots > 0 && OrderCalcProfit(ORDER_TYPE_BUY, sym, lots, t.ask, sl, profit))
     {
      double riskMoney = AccountInfoDouble(ACCOUNT_EQUITY) * riskPercent / 100.0;
      Check("lot-for-risk never exceeds target risk", -profit <= riskMoney + 1e-6,
            StringFormat("lots=%.2f loss=%.2f target=%.2f", lots, -profit, riskMoney));
     }
   else
      Check("lot-for-risk returned a size", lots > 0, StringFormat("lots=%.4f (equity too small for min lot?)", lots));

   //--- full pre-flight, no send
   SAT24ExecConfig cfg; cfg.Defaults();
   cfg.max_spread_points = 0;
   CAT24Exec ex; ex.Init(sym, cfg);
   SAT24ExecResult r;
   double lot = (lots > 0) ? lots : vmin;
   bool ok = ex.PreCheck(ORDER_TYPE_BUY, lot, sl, t.ask + slPoints * 2 * pt, r);
   Check("PreCheck BUY (incl. OrderCheck) passes", ok, StringFormat("status=%d rc=%u %s", (int)r.status, r.retcode, r.reason));
   ok = ex.PreCheck(ORDER_TYPE_BUY, 0.0, sl, 0, r);
   Check("PreCheck rejects zero volume", !ok && r.status == AT24_EXEC_BLOCKED, r.reason);
   cfg.max_spread_points = 0.01;
   ex.Init(sym, cfg);
   ok = ex.PreCheck(ORDER_TYPE_BUY, lot, sl, 0, r);
   Check("PreCheck spread guard blocks", !ok && r.status == AT24_EXEC_BLOCKED, r.reason);

   //--- classification
   Check("retcode: REQUOTE transient", AT24_RetcodeTransient(TRADE_RETCODE_REQUOTE));
   Check("retcode: TIMEOUT unknown-outcome, not transient",
         AT24_RetcodeUnknownOutcome(TRADE_RETCODE_TIMEOUT) && !AT24_RetcodeTransient(TRADE_RETCODE_TIMEOUT));
   Check("retcode: NO_MONEY is fatal",
         !AT24_RetcodeTransient(TRADE_RETCODE_NO_MONEY) && !AT24_RetcodeUnknownOutcome(TRADE_RETCODE_NO_MONEY) && !AT24_RetcodeOK(TRADE_RETCODE_NO_MONEY));

   PrintFormat("[SELFTEST] DONE  pass=%d fail=%d", g_pass, g_fail);
  }

#endif
