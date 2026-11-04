//+------------------------------------------------------------------+
//| Self-test: position-size core on synthetic cases and on the real |
//| symbol, cross-checked against the platform's own OrderCalcProfit |
//| where it is available. Dumps MQL5\Files\PS_selftest.csv for an   |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_PS_Core.mqh"
void OnStart()
  {
   int f = FileOpen("PS_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   //--- synthetic: risk, sl, tickSize, tickValue, min, max, step
   double c[][7] =
     {
      {100.0, 10.0, 0.01, 1.0, 0.01, 100.0, 0.01},     // gold-like: 1 lot = 100 oz, tick 0.01 -> 1 USD
      {250.0, 5.5, 0.01, 1.0, 0.01, 100.0, 0.01},
      {30.0, 10.0, 0.01, 1.0, 0.01, 100.0, 0.01},      // 0.03 lots exactly
      {1.0, 10.0, 0.01, 1.0, 0.01, 100.0, 0.01},       // below minimum lot
      {100000.0, 1.0, 0.01, 1.0, 0.01, 50.0, 0.01},    // capped by max volume
      {100.0, 0.0050, 0.00001, 1.0, 0.01, 100.0, 0.01},// forex-like 50 pips on 5 digits
      {500.0, 0.0030, 0.00001, 0.9, 0.01, 100.0, 0.01},// non-USD account: tick value 0.9
      {75.0, 0.25, 0.01, 0.1, 0.1, 1000.0, 0.1},       // index-like, step 0.1
      {333.33, 7.77, 0.01, 1.0, 0.01, 100.0, 0.01},
      {50.0, 20.0, 0.01, 1.0, 1.0, 100.0, 1.0}         // whole lots only
     };
   int nc = ArrayRange(c, 0);
   for(int i = 0; i < nc; i++)
     {
      AT24PS_Result r;
      AT24PS_Size(c[i][0], c[i][1], c[i][2], c[i][3], c[i][4], c[i][5], c[i][6], r);
      FileWrite(f, "case", c[i][0], c[i][1], c[i][2], c[i][3], c[i][4], c[i][5], c[i][6],
                DoubleToString(r.lossPerLot, 6), DoubleToString(r.rawLots, 8), DoubleToString(r.lots, 8), DoubleToString(r.riskAtLots, 6), r.tooSmall ? 1 : 0, r.capped ? 1 : 0);
     }
   //--- real symbol
   string sym = "XAUUSD";
   SymbolSelect(sym, true);
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), vst = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double cs = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
   bool est = (tv <= 0.0);                       // no account connected: estimate tick value = tick size x contract size
   if(est) tv = ts * cs;
   double price = 3950.0;
   double slDist = 12.5, risk = 200.0;
   AT24PS_Result rr;
   AT24PS_Size(risk, slDist, ts, tv, vmin, vmax, vst, rr);
   double calc = 0.0; bool okc = OrderCalcProfit(ORDER_TYPE_BUY, sym, MathMax(rr.lots, vmin), price, price - slDist, calc);
   PrintFormat("PSTEST estimatedTickValue=%d symbol=%s tickSize=%g tickValueLoss=%g contract=%g min=%g max=%g step=%g lots=%.2f lossPerLot=%.4f riskAtLots=%.4f orderCalcOk=%d orderCalc=%.4f currency=%s",
               est ? 1 : 0, sym, ts, tv, cs, vmin, vmax, vst, rr.lots, rr.lossPerLot, rr.riskAtLots, okc ? 1 : 0, calc, AccountInfoString(ACCOUNT_CURRENCY));
   FileWrite(f, "real", sym, DoubleToString(ts, 8), DoubleToString(tv, 8), DoubleToString(vmin, 4), DoubleToString(vmax, 4), DoubleToString(vst, 4), DoubleToString(cs, 2),
             price, slDist, risk, DoubleToString(rr.lossPerLot, 6), DoubleToString(rr.lots, 8), DoubleToString(rr.riskAtLots, 6), okc ? 1 : 0, DoubleToString(calc, 6), MathMax(rr.lots, vmin));
   FileClose(f);
   Print("PSTEST done");
  }
