//+------------------------------------------------------------------+
//| Self-test: trade-planner maths on XAUUSD symbol values. Also     |
//| cross-checks the money at stop / target against the platform's   |
//| own OrderCalcProfit. Dumps MQL5\Files\TP_selftest.csv for an     |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_TP_Core.mqh"
void OnStart()
  {
   string sym = "XAUUSD";
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   bool tvFallback = false;
   if(tv <= 0.0) { tv = ts * SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE); tvFallback = true; }   // offline terminal: no conversion rate; USD profit currency assumed
   PrintFormat("TPTEST tick size=%.5f tick value=%.5f fallback=%d account=%s", ts, tv, tvFallback ? 1 : 0, AccountInfoString(ACCOUNT_CURRENCY));
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), vstep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double last = SymbolInfoDouble(sym, SYMBOL_BID); if(last <= 0.0) { MqlRates r[]; CopyRates(sym, PERIOD_H1, 1, 1, r); last = r[0].close; }
   int f = FileOpen("TP_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", DoubleToString(ts, 8), DoubleToString(tv, 8), DoubleToString(vmin, 8), DoubleToString(vmax, 8), DoubleToString(vstep, 8), DoubleToString(last, 3));
   double sld[8] = {2.5, 4.0, 7.5, 12.0, 0.8, 30.0, 5.0, 9.0};
   double rrs[8] = {2.0, 1.5, 3.0, 2.5, 1.0, 2.0, 0.8, 1.7};
   double rk[8] = {50, 100, 250, 500, 20, 1000, 75, 333};
   double spr[8] = {0.18, 0.20, 0.15, 0.25, 0.30, 0.18, 0.20, 0.22};
   double com[8] = {0.0, 7.0, 0.0, 3.5, 7.0, 0.0, 5.0, 0.0};
   double dly[8] = {0.0, 500, 1000, 0.0, 300, 5000, 400, 1200};
   int bad = 0;
   for(int k = 0; k < 8; k++)
     {
      int dir = (k % 2 == 0) ? 1 : -1;
      double entry = NormalizeDouble(last + k * 3.0, 2);
      double sl = entry - dir * sld[k], tp = entry + dir * sld[k] * rrs[k];
      AT24TP_Plan p; AT24TP_Plan_Calc(entry, sl, tp, rk[k], ts, tv, vmin, vmax, vstep, spr[k], com[k], dly[k], p);
      double pfSl = 0.0, pfTp = 0.0; bool okp = false;
      if(p.lots > 0.0)
        {
         ENUM_ORDER_TYPE ot = dir > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         bool a = OrderCalcProfit(ot, sym, p.lots, entry, sl, pfSl), b = OrderCalcProfit(ot, sym, p.lots, entry, tp, pfTp);
         okp = a && b && pfSl != 0.0 && pfTp != 0.0;   // offline terminal returns 0 (no quotes)
        }
      FileWrite(f, "case", k, dir, DoubleToString(entry, 3), DoubleToString(sl, 3), DoubleToString(tp, 3), DoubleToString(rk[k], 2), DoubleToString(spr[k], 3), DoubleToString(com[k], 2), DoubleToString(dly[k], 2),
                p.linesOk ? 1 : 0, DoubleToString(p.rr, 8), DoubleToString(p.lots, 8), DoubleToString(p.riskMoney, 6), DoubleToString(p.rewardMoney, 6), DoubleToString(p.spreadCost, 6), DoubleToString(p.commission, 6),
                DoubleToString(p.costShare, 8), DoubleToString(p.dailyShare, 8), okp ? 1 : 0, DoubleToString(pfSl, 6), DoubleToString(pfTp, 6));
      PrintFormat("TPTEST %d dir=%d lots=%.2f risk=%.2f reward=%.2f rr=%.2f cost%%=%.1f daily%%=%.1f | platform sl=%.2f tp=%.2f ok=%d", k, dir, p.lots, p.riskMoney, p.rewardMoney, p.rr, p.costShare, p.dailyShare, pfSl, pfTp, okp ? 1 : 0);
     }
   //--- invalid lines: stop on the wrong side
   AT24TP_Plan q; AT24TP_Plan_Calc(last, last + 3.0, last + 6.0, 100, ts, tv, vmin, vmax, vstep, 0.2, 0.0, 0.0, q);
   FileWrite(f, "bad", q.dir, q.linesOk ? 1 : 0, DoubleToString(q.lots, 4));
   FileClose(f);
   Print("TPTEST done");
  }
