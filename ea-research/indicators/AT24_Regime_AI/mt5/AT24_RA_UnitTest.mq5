//+------------------------------------------------------------------+
//| AT24_RA_UnitTest - hand-worked checks of the Regime AI core      |
//+------------------------------------------------------------------+
#include "AT24_RA_Core.mqh"
int pass = 0, fail = 0;
void Chk(const string name, const bool ok) { if(ok) pass++; else { fail++; Print("FAIL: ", name); } }
bool Near(const double a, const double b, const double e = 1e-9) { return MathAbs(a - b) <= e; }

void OnStart()
  {
   //--- 1. every centroid classifies to itself
   for(int k = 0; k < AT24RA_K; k++)
      Chk("centroid " + IntegerToString(k), AT24RA_Classify(AT24RA_CENT[k][0], AT24RA_CENT[k][1], AT24RA_CENT[k][2], AT24RA_CENT[k][3]) == k);
   //--- 2. names and pooled class
   Chk("name 3", AT24RA_Name(3) == "COMPRESSED");
   Chk("class 0 below", AT24RA_PooledClass(0) == -1 && AT24RA_PooledClass(4) == -1);
   Chk("class 1 above", AT24RA_PooledClass(1) == 1 && AT24RA_PooledClass(2) == 1 && AT24RA_PooledClass(3) == 1);
   //--- 3. straight line up: close = 100 + i, high = close + 0.5, low = close - 0.5
   int n = 300; double h[], l[], c[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { c[i] = 100.0 + i; h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
   double atr[], er[], lv[], sl[], rg[]; bool ok[];
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   Chk("invalid before 99", !ok[98] && ok[99]);
   // TR = max(1, |h-cprev|=1.5, |l-cprev|=0.5) = 1.5 for i>=1 ; TR0 = 1.0 ; ATR14 = 1.5 ; ATR100(i=99) = (1.0 + 99*1.5)/100 = 1.495
   Chk("atr14 line", Near(atr[150], 1.5));
   Chk("er line = 1", Near(er[150], 1.0));
   Chk("lvol line", Near(lv[99], MathLog(1.5 / 1.495)));
   Chk("lvol later = 0", Near(lv[200], 0.0));
   // EMA20 of a line lags by (1-a)/a = 10.5 bars once converged: ema_i - ema_{i-10} = 10 -> slope = 10/1.5 = 6.667 -> capped at 6
   Chk("slope cap", Near(sl[250], 6.0));
   // rngx: 24 bars of the line: hh - ll = 23 + 1 = 24 ; /1.5 = 16
   Chk("rngx line", Near(rg[200], 16.0));
   //--- 4. alternating zig-zag (closes 100,101,100,101...) -> er about 0
   for(int i = 0; i < n; i++) { c[i] = 100.0 + (i % 2); h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   Chk("er zigzag = 0", Near(er[150], 0.0));
   //--- 5. flat market -> invalid (ATR 0 guard) 
   for(int i = 0; i < n; i++) { c[i] = 100.0; h[i] = 100.0; l[i] = 100.0; }
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   Chk("flat market invalid", !ok[150]);
   //--- 6. forward range: line, window i+1..i+24: high max = c[i+24]+0.5, low min = c[i+1]-0.5 -> 24 ; ATR14 = 1.5 -> 16
   for(int i = 0; i < n; i++) { c[i] = 100.0 + i; h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   double fr[]; AT24RA_Forward(n, h, l, atr, ok, fr);
   Chk("forward line", Near(fr[150], 24.0 / 1.5));
   Chk("forward unknown at end", fr[n - 1] < 0.0 && fr[n - 24] < 0.0 && fr[n - 25] >= 0.0);
   Chk("forward unknown before valid", fr[50] < 0.0);
   //--- 7. stats on a hand sequence: states 0 0 0 1 1 0, forward 2 2 2 4 4 -1 (valid from index 99 -> shift indexes)
   int m = AT24RA_FIRST + 6; int st[]; double f2[]; ArrayResize(st, m); ArrayResize(f2, m);
   for(int i = 0; i < m; i++) { st[i] = -1; f2[i] = -1.0; }
   int pat[6] = {0, 0, 0, 1, 1, 0}; double fv[6] = {2, 2, 2, 4, 4, -1};
   for(int i = 0; i < 6; i++) { st[AT24RA_FIRST + i] = pat[i]; f2[AT24RA_FIRST + i] = fv[i]; }
   AT24RA_Stat s; AT24RA_Stats(m, AT24RA_FIRST, st, f2, s);
   Chk("stat n0 = 4, n1 = 2", s.n[0] == 4 && s.n[1] == 2);
   Chk("stat share", Near(s.share[0], 4.0 / 6.0) && Near(s.share[1], 2.0 / 6.0));
   // runs: state0 has runs {3,1} -> mean 2.0 ; state1 one run of 2
   Chk("stat meanRun", Near(s.meanRun[0], 2.0) && Near(s.meanRun[1], 2.0));
   // transitions from bars 0..4 (bar 5 has no next): state0 bars 0,1,2 -> next 0,0,1 : stay 2/3 ; state1 bars 3,4 -> next 1,0 : stay 1/2
   Chk("stat pStay", Near(s.pStay[0], 2.0 / 3.0) && Near(s.pStay[1], 0.5));
   Chk("stat allFwd", Near(s.allFwd, 14.0 / 5.0));
   Chk("ratio no claim under 200", s.ratio[0] == 0.0 && s.ratio[1] == 0.0);
   //--- 8. run length helper
   Chk("run len 1 bar", AT24RA_RunLen(st, AT24RA_FIRST + 5) == 1);
   Chk("run len 3 bars", AT24RA_RunLen(st, AT24RA_FIRST + 2) == 3);
   Chk("run len invalid", AT24RA_RunLen(st, 10) == 0);
   //--- 9. ratio needs 200 bars: 300 bars state 2 with forward 3, 300 bars state 4 with forward 1
   int q = AT24RA_FIRST + 600; int st3[]; double f3[]; ArrayResize(st3, q); ArrayResize(f3, q);
   for(int i = 0; i < q; i++) { st3[i] = -1; f3[i] = -1.0; }
   for(int i = 0; i < 600; i++) { st3[AT24RA_FIRST + i] = (i < 300) ? 2 : 4; f3[AT24RA_FIRST + i] = (i < 300) ? 3.0 : 1.0; }
   AT24RA_Stat s3; AT24RA_Stats(q, AT24RA_FIRST, st3, f3, s3);
   Chk("ratio state 2 = 1.5", Near(s3.ratio[2], 1.5));
   Chk("ratio state 4 = 0.5", Near(s3.ratio[4], 0.5));
   PrintFormat("AT24 RA unit test: %d passed, %d failed", pass, fail);
  }
