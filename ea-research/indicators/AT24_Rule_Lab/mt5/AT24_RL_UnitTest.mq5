//+------------------------------------------------------------------+
//| AT24_RL_UnitTest - hand-worked checks of the Rule Lab core       |
//+------------------------------------------------------------------+
#include "AT24_RL_Core.mqh"
int pass = 0, fail = 0;
void Chk(const string name, const bool ok) { if(ok) pass++; else { fail++; Print("FAIL: ", name); } }
bool Near(const double a, const double b, const double e = 1e-9) { return MathAbs(a - b) <= e; }

void Line(const int n, double &o[], double &h[], double &l[], double &c[], const double start, const double step)
  {
   for(int i = 0; i < n; i++) { c[i] = start + step * i; o[i] = c[i]; h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
  }

void OnStart()
  {
   //--- 1. weighted moving average
   double w1[4] = {1, 2, 3, 4};
   Chk("WMA(1,2,3,4) = 3", Near(AT24RL_Wma(w1, 3, 4), 3.0));
   double w2[4] = {0, 0, 5, 5};
   Chk("WMA(0,0,5,5) over 2 = 5", Near(AT24RL_Wma(w2, 3, 2), 5.0));
   //--- 2. straight line up
   int n = 400; double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   Line(n, o, h, l, c, 100.0, 1.0);
   int sig[]; AT24RL_Signals(n, h, l, c, sig);
   Chk("no signal before 250", sig[249 * 6 + 0] == 0 && sig[249 * 6 + 2] == 0 && sig[249 * 6 + 4] == 0);
   Chk("KAMA long on a line", sig[300 * 6 + 0] == 1);
   Chk("FRAMA gives 0 on a perfect line (D = 1, alpha = 1, FRAMA = close)", sig[300 * 6 + 1] == 0);
   Chk("HMA long on a line (HMA = close - 1/3)", sig[300 * 6 + 2] == 1);
   Chk("Vortex long on a line (VI+ 2.0 vs VI- 0)", sig[300 * 6 + 4] == 1);
   Chk("Squeeze none on a line (dev 11.5 > 2.25)", sig[300 * 6 + 5] == 0);
   //--- 3. line down mirrors
   Line(n, o, h, l, c, 1000.0, -1.0);
   AT24RL_Signals(n, h, l, c, sig);
   Chk("KAMA short on a line down", sig[300 * 6 + 0] == -1);
   Chk("HMA short on a line down", sig[300 * 6 + 2] == -1);
   Chk("Vortex short on a line down", sig[300 * 6 + 4] == -1);
   //--- 4. flat market: nothing signals
   for(int i = 0; i < n; i++) { c[i] = 100.0; o[i] = 100.0; h[i] = 100.1; l[i] = 99.9; }
   AT24RL_Signals(n, h, l, c, sig);
   bool none = true; for(int r = 0; r < 6; r++) if(sig[300 * 6 + r] != 0) none = false;
   Chk("flat market: all six rules silent", none);
   //--- 5. squeeze release: flat (squeeze on) then a +2 bar at i = 300, mom = 102 - 100.55 = 1.45
   c[300] = 102.0; h[300] = 102.1; l[300] = 100.0;
   for(int i = 301; i < n; i++) { c[i] = 102.0; h[i] = 102.1; l[i] = 101.9; }
   AT24RL_Signals(n, h, l, c, sig);
   Chk("squeeze release long at 300", sig[300 * 6 + 5] == 1);
   Chk("no signal the bar before and after", sig[299 * 6 + 5] == 0 && sig[301 * 6 + 5] == 0);
   //--- 6. squeeze release short: close 98, high 100, low 97.9, mom = 98 - 99.45 = -1.45
   for(int i = 0; i < n; i++) { c[i] = 100.0; h[i] = 100.1; l[i] = 99.9; }
   c[300] = 98.0; h[300] = 100.0; l[300] = 97.9;
   for(int i = 301; i < n; i++) { c[i] = 98.0; h[i] = 98.1; l[i] = 97.9; }
   AT24RL_Signals(n, h, l, c, sig);
   Chk("squeeze release short at 300", sig[300 * 6 + 5] == -1);
   //--- 7. trades on a line up: KAMA, HMA, Vortex signal every bar from 250 -> 6 trades each (i = 250, 274, ..., 370), R = (24 - 0.5) / 2
   Line(n, o, h, l, c, 100.0, 1.0);
   AT24RL_Signals(n, h, l, c, sig);
   double atr[]; bool ok[]; int st[]; ArrayResize(atr, n); ArrayResize(ok, n); ArrayResize(st, n);
   for(int i = 0; i < n; i++) { atr[i] = 2.0; ok[i] = true; st[i] = 3; }
   AT24RL_Res res; AT24RL_Run(n, o, h, l, atr, ok, st, sig, 0.5, 0.0, 0, res);
   Chk("KAMA: 6 trades, R 11.75", res.c[0 * 5 + 3].n == 6 && Near(res.c[0 * 5 + 3].avg, 11.75));
   Chk("HMA: 6 trades", res.c[2 * 5 + 3].n == 6 && Near(res.c[2 * 5 + 3].avg, 11.75));
   Chk("Vortex: 6 trades", res.c[4 * 5 + 3].n == 6 && Near(res.c[4 * 5 + 3].avg, 11.75));
   Chk("FRAMA and Squeeze: no trades", res.c[1 * 5 + 3].n == 0 && res.c[5 * 5 + 3].n == 0);
   Chk("total 18, none stopped", res.trades == 18 && res.stopped == 0);
   //--- 8. a 0.1 ATR stop hits on the entry bar: R = (-0.2 - 0.5) / 2 = -0.35, all 18 stopped
   AT24RL_Run(n, o, h, l, atr, ok, st, sig, 0.5, 0.1, 0, res);
   Chk("tiny stop: every trade stopped", res.stopped == 18 && Near(res.c[0 * 5 + 3].avg, -0.35));
   //--- 9. 'from' and too short
   AT24RL_Run(n, o, h, l, atr, ok, st, sig, 0.5, 0.0, 300, res);
   Chk("from 300: 4 trades per rule (300, 324, 348, 372)", res.c[0 * 5 + 3].n == 4);
   AT24RL_Run(260, o, h, l, atr, ok, st, sig, 0.5, 0.0, 0, res);
   Chk("n 260: no trades", res.trades == 0);
   PrintFormat("AT24 RL unit test: %d passed, %d failed", pass, fail);
  }
