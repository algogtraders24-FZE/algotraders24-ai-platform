//+------------------------------------------------------------------+
//| AT24_AF_UnitTest - hand-worked checks of the Analog Finder core  |
//+------------------------------------------------------------------+
#include "AT24_AF_Core.mqh"
int pass = 0, fail = 0;
void Chk(const string name, const bool ok) { if(ok) pass++; else { fail++; Print("FAIL: ", name); } }
bool Near(const double a, const double b, const double e = 1e-9) { return MathAbs(a - b) <= e; }

void OnStart()
  {
   //--- 1. quantiles
   double s5[5] = {1, 2, 3, 4, 5};
   Chk("median 1..5", Near(AT24AF_Quant(s5, 5, 0.5), 3.0));
   Chk("q10 1..5 = 1.4", Near(AT24AF_Quant(s5, 5, 0.1), 1.4));
   Chk("q90 1..5 = 4.6", Near(AT24AF_Quant(s5, 5, 0.9), 4.6));
   //--- 2. features on a straight line up: c = 100 + i, h = c + 0.5, l = c - 0.5 (ATR14 = 1.5)
   int n = 1300; double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { c[i] = 100.0 + i; h[i] = c[i] + 0.5; l[i] = c[i] - 0.5; }
   double f[], atr[], y[]; bool ok[], yok[];
   AT24AF_Series(n, h, l, c, f, atr, y, ok, yok);
   int r = 1000;
   Chk("not valid before 250", !ok[249] && ok[250]);
   Chk("atr 1.5", Near(atr[r], 1.5));
   Chk("returns 1/3/6/12/24/48 bars", Near(f[r * 12 + 0], 1.0 / 1.5) && Near(f[r * 12 + 1], 2.0) && Near(f[r * 12 + 2], 4.0) && Near(f[r * 12 + 3], 8.0) && Near(f[r * 12 + 4], 16.0) && Near(f[r * 12 + 5], 32.0));
   Chk("ln ATR ratio 0", Near(f[r * 12 + 6], 0.0));
   Chk("RSI of a line = 100 -> 2.0", Near(f[r * 12 + 7], 2.0, 1e-6));
   Chk("ema20 distance = 9.5 / 1.5 (lag (1 - a) / a = 9.5 bars)", Near(f[r * 12 + 8], 9.5 / 1.5, 1e-3));
   Chk("ema50 distance = 24.5 / 1.5", Near(f[r * 12 + 9], 24.5 / 1.5, 1e-3));
   Chk("ema200 distance = 99.5 / 1.5", Near(f[r * 12 + 10], 99.5 / 1.5, 0.02));
   Chk("position in the 48-bar range = 47.5 / 48", Near(f[r * 12 + 11], 47.5 / 48.0, 1e-6));
   Chk("outcome (24 bars) = 16 ATR", yok[r] && Near(y[r], 16.0));
   Chk("outcome unknown at the end", yok[n - 25] && !yok[n - 24]);
   //--- 3. scaling on synthetic features: column 0 = row index, the others constant
   int m = 1200; double fs[], ys[]; bool oks[], yoks[];
   ArrayResize(fs, m * 12); ArrayResize(ys, m); ArrayResize(oks, m); ArrayResize(yoks, m);
   for(int i = 0; i < m; i++)
     {
      for(int q = 0; q < 12; q++) fs[i * 12 + q] = (q == 0) ? (double)i : 3.0;
      oks[i] = (i >= 250); yoks[i] = (i >= 250 && i <= m - 25); ys[i] = (double)i;
     }
   double mu[], sd[]; int sEnd;
   Chk("scale ok", AT24AF_Scale(m, fs, oks, yoks, mu, sd, sEnd));
   Chk("scale sample end 805", sEnd == 805);
   Chk("mean of 250..805 = 527.5", Near(mu[0], 527.5) && Near(mu[1], 3.0));
   Chk("population sd of 556 integers", Near(sd[0], MathSqrt((556.0 * 556.0 - 1.0) / 12.0), 1e-9) && sd[1] < 1e-9);
   //--- 4. search: feature 0 = row index, outcome = row index; query feature 500.2 (z with mu 0, sd 1)
   double mu0[12], sd0[12]; for(int q = 0; q < 12; q++) { mu0[q] = 0.0; sd0[q] = 1.0; }
   double fq[]; ArrayResize(fq, 1201 * 12); ArrayCopy(fq, fs, 0, 0, m * 12);
   for(int q = 0; q < 12; q++) fq[1200 * 12 + q] = (q == 0) ? 500.2 : 3.0;
   bool okq[], yokq[]; double yq[]; ArrayResize(okq, 1201); ArrayResize(yokq, 1201); ArrayResize(yq, 1201);
   for(int i = 0; i < 1201; i++) { okq[i] = (i >= 250); yokq[i] = (i >= 250 && i <= 1175); yq[i] = (double)i; }
   AT24AF_Stat st; AT24AF_Search(1200, 1175, fq, okq, yokq, yq, mu0, sd0, st);
   Chk("30 analogs", st.k == 30);
   Chk("nearest first: 500, 524, 476, 548, 452", st.idx[0] == 500 && st.idx[1] == 524 && st.idx[2] == 476 && st.idx[3] == 548 && st.idx[4] == 452);
   bool sep = true; for(int a = 0; a < st.k; a++) for(int b = a + 1; b < st.k; b++) if(MathAbs(st.idx[a] - st.idx[b]) < 24) sep = false;
   Chk("all analogs at least 24 bars apart", sep);
   bool inr = true; for(int a = 0; a < st.k; a++) if(st.idx[a] < 250 || st.idx[a] > 1175) inr = false;
   Chk("analogs inside the candidate rows", inr);
   Chk("all outcomes up", Near(st.shareUp, 1.0) && st.q10 > 0.0);
   Chk("mean distance above the first distance", st.meanDist > 0.2);
   //--- 5. few candidates: rows 250..260 only, query 255.4 -> one analog (255), everything else within 23 bars
   fq[1200 * 12 + 0] = 255.4;
   AT24AF_Search(1200, 260, fq, okq, yokq, yq, mu0, sd0, st);
   Chk("one analog when all candidates are close", st.k == 1 && st.idx[0] == 255 && Near(st.q50, 255.0) && Near(st.mean, 255.0));
   //--- 6. self-test: outcome +1 everywhere, feature 0 = row index -> every test point is selected and wins
   int T = 4000; double ft[], yt[]; bool okt[], yokt[];
   ArrayResize(ft, T * 12); ArrayResize(yt, T); ArrayResize(okt, T); ArrayResize(yokt, T);
   for(int i = 0; i < T; i++)
     {
      for(int q = 0; q < 12; q++) ft[i * 12 + q] = (q == 0) ? (double)i : 0.0;
      okt[i] = (i >= 250); yokt[i] = (i >= 250 && i <= T - 25); yt[i] = 1.0;
     }
   double mut[], sdt[]; int se;
   AT24AF_Scale(T, ft, okt, yokt, mut, sdt, se);
   AT24AF_Self sf; AT24AF_SelfTest(T, ft, okt, yokt, yt, mut, sdt, se, sf);
   // sEnd = 250 + floor(0.6 * (4000 - 25 - 250)) = 2485; test points 2486, 2510, ..., 3974 -> 63
   Chk("scale end 2485", se == 2485);
   Chk("63 test points", sf.ok && sf.nTest == 63);
   Chk("all selected, all wins", sf.nSel == 63 && Near(sf.hit, 1.0) && Near(sf.avgR, 1.0));
   Chk("band held 100 %, always long 1", Near(sf.bandHeld, 1.0) && Near(sf.alwaysLong, 1.0));
   Chk("luck test: worked", sf.cls == 1 && sf.p < 0.01);
   //--- 7. self-test with a feature that does not tell the outcomes apart: it runs and returns shares
   for(int i = 0; i < T; i++) { yt[i] = (i % 24 < 12) ? 1.0 : -1.0; ft[i * 12 + 0] = (double)(i % 2); }
   AT24AF_Scale(T, ft, okt, yokt, mut, sdt, se);
   AT24AF_SelfTest(T, ft, okt, yokt, yt, mut, sdt, se, sf);
   Chk("self-test ran", sf.ok && sf.nTest > 50);
   Chk("coverage is a share", sf.bandHeld >= 0.0 && sf.bandHeld <= 1.0);
   PrintFormat("AT24 AF unit test: %d passed, %d failed", pass, fail);
  }
