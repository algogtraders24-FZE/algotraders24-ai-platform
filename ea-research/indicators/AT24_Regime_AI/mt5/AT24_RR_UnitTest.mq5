//+------------------------------------------------------------------+
//| AT24_RR_UnitTest - hand-worked checks of the expected-range core |
//+------------------------------------------------------------------+
#include "AT24_RA_Range.mqh"
int pass = 0, fail = 0;
void Chk(const string name, const bool ok) { if(ok) pass++; else { fail++; Print("FAIL: ", name); } }
bool Near(const double a, const double b, const double e = 1e-9) { return MathAbs(a - b) <= e; }

void OnStart()
  {
   //--- 1. quantiles (linear interpolation)
   double s5[5] = {1, 2, 3, 4, 5};
   Chk("median of 1..5", Near(AT24RR_Quant(s5, 5, 0.5), 3.0));
   Chk("q10 of 1..5 = 1.4", Near(AT24RR_Quant(s5, 5, 0.1), 1.4));
   Chk("q90 of 1..5 = 4.6", Near(AT24RR_Quant(s5, 5, 0.9), 4.6));
   double s1[1] = {7.5};
   Chk("one value", Near(AT24RR_Quant(s1, 1, 0.9), 7.5));
   Chk("empty", Near(AT24RR_Quant(s1, 0, 0.5), 0.0));
   //--- 2. linear solve
   double A2[4] = {2, 1, 1, 3}; double b2[2] = {3, 5}; double x2[];
   Chk("solve 2x2", AT24RR_Solve(2, A2, b2, x2) && Near(x2[0], 0.8) && Near(x2[1], 1.4));
   double A3[9] = {0, 2, 1, 1, 1, 0, 2, 0, 1}; double b3[3] = {5, 3, 4}; double x3[];   // first pivot is 0 (needs a row swap): x = (1.25, 1.75, 1.5)
   Chk("solve 3x3 with pivoting", AT24RR_Solve(3, A3, b3, x3) && Near(x3[0], 1.25) && Near(x3[1], 1.75) && Near(x3[2], 1.5));
   double As[4] = {1, 2, 2, 4}; double bs[2] = {1, 2}; double xs[];
   Chk("singular matrix", !AT24RR_Solve(2, As, bs, xs));
   //--- 3. hour of a timestamp
   Chk("hour 3", AT24RR_Hour((datetime)(5 * 86400 + 3 * 3600 + 1799)) == 3);
   Chk("hour 0", AT24RR_Hour((datetime)(7 * 86400)) == 0);
   Chk("hour 23", AT24RR_Hour((datetime)(7 * 86400 + 23 * 3600)) == 23);
   //--- 4. series on constant bars: c 100, h 101, l 99: TR 2, ATR 2, forward range 2 / 100
   int n = 3000; double h[], l[], c[]; datetime t[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(t, n);
   for(int i = 0; i < n; i++) { c[i] = 100.0; h[i] = 101.0; l[i] = 99.0; t[i] = (datetime)(1700000000 + i * 3600); }
   double la14[], la24[], la120[], y[]; bool ok[], yok[];
   AT24RR_Series(n, h, l, c, la14, la24, la120, y, ok, yok);
   Chk("not valid before 150", !ok[149] && ok[150]);
   Chk("la14 = ln(0.02)", Near(la14[200], MathLog(0.02)) && Near(la24[200], MathLog(0.02)) && Near(la120[200], MathLog(0.02)));
   Chk("target = ln(0.02)", yok[200] && Near(y[200], MathLog(0.02)));
   Chk("target known up to n-25", yok[n - 25] && !yok[n - 24]);
   //--- 5. a bar with a gap: TR uses the previous close (h 110, l 108, previous close 100 -> TR 10)
   double h2[5] = {101, 101, 110, 101, 101}, l2[5] = {99, 99, 108, 99, 99}, c2[5] = {100, 100, 109, 100, 100};
   double a14[], a24[], a120[], yy[]; bool o2[], yo2[];
   AT24RR_Series(5, h2, l2, c2, a14, a24, a120, yy, o2, yo2);
   Chk("short history has no valid rows", !o2[4]);
   //--- 6. whole run on constant bars: model must return the constant range exactly (2.0), band 2.0 - 2.0, coverage 100 %
   AT24RR_Out o; AT24RR_Run(n, 0, t, h, l, c, o);
   Chk("run ok", o.ok && o.nTrain > 1500);
   Chk("expected range = 2.0", Near(o.mid, 2.0, 1e-6) && Near(o.lo, 2.0, 1e-6) && Near(o.hi, 2.0, 1e-6));
   Chk("percent = 2.0", Near(o.midPct, 2.0, 1e-6));
   Chk("coverage 100 %", o.nCover > 100 && Near(o.cover, 1.0));
   //--- 7. too short: no model
   AT24RR_Out o3; AT24RR_Run(1000, 0, t, h, l, c, o3);
   Chk("n 1000: no model", !o3.ok);
   //--- 8. the price scales the result: c 200, h 202, l 198 gives the same percent, double the price units
   for(int i = 0; i < n; i++) { c[i] = 200.0; h[i] = 202.0; l[i] = 198.0; }
   AT24RR_Run(n, 0, t, h, l, c, o);
   Chk("scale: 4.0 units, 2.0 %", Near(o.mid, 4.0, 1e-6) && Near(o.midPct, 2.0, 1e-6));
   //--- 9. hour pattern: bars of hour 0-11 have range 2, hours 12-23 range 4 -> 24-bar forward range always spans both = 4 + gaps; model still returns a finite band, coverage >= 0.8
   for(int i = 0; i < n; i++) { int hr = AT24RR_Hour(t[i]); double hw = (hr < 12) ? 1.0 : 2.0; c[i] = 100.0; h[i] = 100.0 + hw; l[i] = 100.0 - hw; }
   AT24RR_Run(n, 0, t, h, l, c, o);
   Chk("periodic volatility: finite band", o.ok && o.lo > 0.0 && o.hi >= o.lo && o.cover >= 0.8);
   PrintFormat("AT24 RR unit test: %d passed, %d failed", pass, fail);
  }
