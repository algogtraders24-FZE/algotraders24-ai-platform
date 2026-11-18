//+------------------------------------------------------------------+
//| AT24_SF_UnitTest - hand-worked checks of the Strategy Fit core   |
//+------------------------------------------------------------------+
#include "AT24_SF_Core.mqh"
int pass = 0, fail = 0;
void Chk(const string name, const bool ok) { if(ok) pass++; else { fail++; Print("FAIL: ", name); } }
bool Near(const double a, const double b, const double e = 1e-9) { return MathAbs(a - b) <= e; }

void Line(const int n, double &o[], double &h[], double &l[], double &c[], const double start, const double step)
  {
   for(int i = 0; i < n; i++) { c[i] = start + step * i; o[i] = c[i]; h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
  }

void OnStart()
  {
   //--- 1. xorshift32 known sequence from seed 1
   uint x = 1;
   Chk("xorshift first", AT24SF_Next(x) == 270369);
   Chk("xorshift second", AT24SF_Next(x) == 67634689);
   //--- 2. straight line up
   int n = 400; double h[], l[], c[], o[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(o, n);
   Line(n, o, h, l, c, 100.0, 1.0);
   int sig[]; AT24SF_Signals(n, h, l, c, sig);
   Chk("no signal before 250", sig[249 * 3 + 0] == 0 && sig[249 * 3 + 1] == 0 && sig[249 * 3 + 2] == 0);
   Chk("trend long on a line", sig[300 * 3 + 0] == 1);
   Chk("breakout long on a line", sig[300 * 3 + 1] == 1);
   Chk("reversion short on a line (RSI 100)", sig[300 * 3 + 2] == -1);
   //--- 3. line down mirrors
   Line(n, o, h, l, c, 1000.0, -1.0);
   AT24SF_Signals(n, h, l, c, sig);
   Chk("trend short on a line down", sig[300 * 3 + 0] == -1);
   Chk("breakout short on a line down", sig[300 * 3 + 1] == -1);
   Chk("reversion long on a line down (RSI 0)", sig[300 * 3 + 2] == 1);
   //--- 4. zig-zag 100,101: RSI about 50, equal highs: no reversion, no breakout
   for(int i = 0; i < n; i++) { c[i] = 100.0 + (i % 2); o[i] = c[i]; h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
   AT24SF_Signals(n, h, l, c, sig);
   Chk("zig-zag no reversion", sig[300 * 3 + 2] == 0 && sig[301 * 3 + 2] == 0);
   Chk("zig-zag no breakout", sig[300 * 3 + 1] == 0 && sig[301 * 3 + 1] == 0);
   //--- 5. cell statistics
   double v[]; ArrayResize(v, 40); AT24SF_Cell cell;
   for(int i = 0; i < 40; i++) v[i] = 1.0;
   AT24SF_CellOf(v, 40, cell);
   Chk("all wins: avg, hit, FIT", Near(cell.avg, 1.0) && Near(cell.hit, 1.0) && cell.p < 0.01 && cell.cls == 1);
   for(int i = 0; i < 40; i++) v[i] = -1.0;
   AT24SF_CellOf(v, 40, cell);
   Chk("all losses: AVOID, p = 1", Near(cell.avg, -1.0) && Near(cell.hit, 0.0) && Near(cell.p, 1.0) && cell.cls == -1);
   AT24SF_CellOf(v, 29, cell);
   Chk("n 29: no claim", cell.cls == 2 && cell.n == 29);
   for(int i = 0; i < 40; i++) v[i] = (i % 2 == 0) ? 1.0 : -1.0;
   AT24SF_CellOf(v, 40, cell);
   Chk("balanced: neutral", Near(cell.avg, 0.0) && cell.cls == 0 && cell.p > 0.3);
   AT24SF_CellOf(v, 0, cell);
   Chk("empty cell", cell.n == 0 && cell.cls == 2 && Near(cell.p, 1.0));
   //--- 6. run on a line up: all bars valid, state 3, ATR 2, cost 0.5
   Line(n, o, h, l, c, 100.0, 1.0);
   AT24SF_Signals(n, h, l, c, sig);
   double atr[]; bool ok[]; int st[]; ArrayResize(atr, n); ArrayResize(ok, n); ArrayResize(st, n);
   for(int i = 0; i < n; i++) { atr[i] = 2.0; ok[i] = true; st[i] = 3; }
   AT24SF_Res res; AT24SF_Run(n, o, atr, ok, st, sig, 0.5, 0, res);
   // trades at i = 250, 274, 298, 322, 346, 370 (i + 25 <= 399)
   Chk("breakout: 6 trades in state 3", res.c[1 * 5 + 3].n == 6);
   Chk("breakout average R = (24 - 0.5) / 2", Near(res.c[1 * 5 + 3].avg, 11.75));
   Chk("trend: 6 trades", res.c[0 * 5 + 3].n == 6 && Near(res.c[0 * 5 + 3].avg, 11.75));
   Chk("reversion short loses: (-24 - 0.5) / 2", res.c[2 * 5 + 3].n == 6 && Near(res.c[2 * 5 + 3].avg, -12.25));
   Chk("other states empty", res.c[1 * 5 + 0].n == 0 && res.c[1 * 5 + 4].n == 0);
   Chk("total trades 18", res.trades == 18);
   //--- 7. 'from' limits the history: trades at 300, 324, 348, 372
   AT24SF_Run(n, o, atr, ok, st, sig, 0.5, 300, res);
   Chk("from 300: 4 breakout trades", res.c[1 * 5 + 3].n == 4);
   //--- 8. too short: no trade has a known exit
   AT24SF_Run(260, o, atr, ok, st, sig, 0.5, 0, res);
   Chk("n 260: no trades", res.trades == 0);
   //--- 9. a bar with invalid features is skipped and does not start the wait
   for(int i = 0; i < n; i++) ok[i] = (i != 250);
   AT24SF_Run(n, o, atr, ok, st, sig, 0.5, 0, res);
   // trades at 251, 275, 299, 323, 347, 371 (371 + 25 = 396 <= 399)
   Chk("invalid bar skipped, wait not started", res.c[1 * 5 + 3].n == 6);
   //--- 10. flat market: no trend, no breakout
   for(int i = 0; i < n; i++) { c[i] = 100.0; o[i] = c[i]; h[i] = c[i]; l[i] = c[i]; }
   AT24SF_Signals(n, h, l, c, sig);
   Chk("flat: no trend, no breakout", sig[300 * 3 + 0] == 0 && sig[300 * 3 + 1] == 0);
   PrintFormat("AT24 SF unit test: %d passed, %d failed", pass, fail);
  }
