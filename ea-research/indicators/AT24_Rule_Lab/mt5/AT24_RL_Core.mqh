//+------------------------------------------------------------------+
//| AT24_RL_Core.mqh - AT24 Rule Lab engine (pure functions)         |
//| Six rules (KAMA, FRAMA, HMA, TSI, Vortex, Squeeze), their trades |
//| and the result per Regime AI state. Rules: SPEC.md section 2-3.  |
//| Chronological arrays. Needs AT24_SF_Core.mqh (luck test, cell).  |
//+------------------------------------------------------------------+
#ifndef AT24_RL_CORE_MQH
#define AT24_RL_CORE_MQH

#include "AT24_SF_Core.mqh"

#define AT24RL_NR     6
#define AT24RL_NC     30            // cells = rule * 5 + state
#define AT24RL_FIRST  250

string AT24RL_RuleName(const int r)
  {
   switch(r)
     {
      case 0: return "KAMA";
      case 1: return "FRAMA";
      case 2: return "HMA";
      case 3: return "TSI";
      case 4: return "VORTEX";
      case 5: return "SQUEEZE";
     }
   return "-";
  }

struct AT24RL_Res
  {
   AT24SF_Cell c[AT24RL_NC];
   int         trades;
   int         stopped;
  };

//--- weighted moving average (weights 1..m, newest bar weight m) of x over x[i-m+1..i]; valid from index i0 + m - 1
double AT24RL_Wma(const double &x[], const int i, const int m)
  {
   double s = 0.0, w = 0.0;
   for(int k = 0; k < m; k++) { double wt = (double)(m - k); s += wt * x[i - k]; w += wt; }
   return s / w;
  }

//--- signals of every bar: sig[i * 6 + rule] = +1 / -1 / 0 (0 before bar 250)
void AT24RL_Signals(const int n, const double &h[], const double &l[], const double &c[], int &sig[])
  {
   ArrayResize(sig, n * AT24RL_NR);
   double tr[], kama[], fr[], raw[], hma[], e1[], e2[], e3[], e4[], tsi[], tsg[];
   ArrayResize(tr, n); ArrayResize(kama, n); ArrayResize(fr, n); ArrayResize(raw, n); ArrayResize(hma, n);
   ArrayResize(e1, n); ArrayResize(e2, n); ArrayResize(e3, n); ArrayResize(e4, n); ArrayResize(tsi, n); ArrayResize(tsg, n);
   for(int i = 0; i < n; i++)
     {
      tr[i] = h[i] - l[i];
      if(i > 0) tr[i] = MathMax(tr[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
      kama[i] = c[i]; fr[i] = c[i]; raw[i] = 0.0; hma[i] = 0.0; e1[i] = 0.0; e2[i] = 0.0; e3[i] = 0.0; e4[i] = 0.0; tsi[i] = 0.0; tsg[i] = 0.0;
     }
   bool sqzPrev = false;
   for(int i = 0; i < n; i++)
     {
      for(int r = 0; r < AT24RL_NR; r++) sig[i * AT24RL_NR + r] = 0;
      //--- KAMA
      if(i > 0)
        {
         double sc = (2.0 / 31.0) * (2.0 / 31.0);
         if(i >= 10)
           {
            double den = 0.0; for(int j = i - 9; j <= i; j++) den += MathAbs(c[j] - c[j - 1]);
            double er = (den > 0.0) ? MathAbs(c[i] - c[i - 10]) / den : 0.0;
            double a = er * (2.0 / 3.0 - 2.0 / 31.0) + 2.0 / 31.0; sc = a * a;
           }
         kama[i] = kama[i - 1] + sc * (c[i] - kama[i - 1]);
        }
      //--- FRAMA (16)
      if(i >= 16)
        {
         double hh1 = h[i], ll1 = l[i], hh2 = h[i - 15], ll2 = l[i - 15];
         for(int j = i - 7; j <= i; j++) { if(h[j] > hh1) hh1 = h[j]; if(l[j] < ll1) ll1 = l[j]; }
         for(int j = i - 15; j <= i - 8; j++) { if(h[j] > hh2) hh2 = h[j]; if(l[j] < ll2) ll2 = l[j]; }
         double n1 = (hh1 - ll1) / 8.0, n2 = (hh2 - ll2) / 8.0, n3 = (MathMax(hh1, hh2) - MathMin(ll1, ll2)) / 16.0;
         double al = 0.5;
         if(n1 > 0.0 && n2 > 0.0 && n3 > 0.0)
           {
            double D = (MathLog(n1 + n2) - MathLog(n3)) / MathLog(2.0);
            al = MathMin(1.0, MathMax(0.01, MathExp(-4.6 * (D - 1.0))));
           }
         fr[i] = al * c[i] + (1.0 - al) * fr[i - 1];
        }
      //--- HMA (21): raw = 2 WMA10 - WMA21 from i = 20; HMA = WMA4 of raw from i = 23
      if(i >= 20) raw[i] = 2.0 * AT24RL_Wma(c, i, 10) - AT24RL_Wma(c, i, 21);
      if(i >= 23) hma[i] = AT24RL_Wma(raw, i, 4);
      //--- TSI: EMAs seeded on the first value (i = 1)
      if(i == 1)
        {
         double m1 = c[1] - c[0];
         e1[1] = m1; e2[1] = e1[1]; e3[1] = MathAbs(m1); e4[1] = e3[1];
         double den0 = e4[1] + 1e-12; tsi[1] = 100.0 * e2[1] / den0; tsg[1] = tsi[1];
        }
      else if(i > 1)
        {
         double mm = c[i] - c[i - 1];
         e1[i] = (2.0 / 26.0) * mm + (1.0 - 2.0 / 26.0) * e1[i - 1];
         e2[i] = (2.0 / 14.0) * e1[i] + (1.0 - 2.0 / 14.0) * e2[i - 1];
         e3[i] = (2.0 / 26.0) * MathAbs(mm) + (1.0 - 2.0 / 26.0) * e3[i - 1];
         e4[i] = (2.0 / 14.0) * e3[i] + (1.0 - 2.0 / 14.0) * e4[i - 1];
         tsi[i] = 100.0 * e2[i] / (e4[i] + 1e-12);
         tsg[i] = (2.0 / 8.0) * tsi[i] + (1.0 - 2.0 / 8.0) * tsg[i - 1];
        }
      //--- Squeeze (20): state of this bar; the signal needs the previous bar's state
      bool sqz = false; double mom = 0.0;
      if(i >= 19)
        {
         double s = 0.0, ss = 0.0, atr = 0.0, hh = h[i], ll = l[i];
         for(int j = i - 19; j <= i; j++) { s += c[j]; atr += tr[j]; if(h[j] > hh) hh = h[j]; if(l[j] < ll) ll = l[j]; }
         double basis = s / 20.0;
         for(int j = i - 19; j <= i; j++) { double d = c[j] - basis; ss += d * d; }
         double dev = 2.0 * MathSqrt(ss / 20.0);
         sqz = (dev < 1.5 * (atr / 20.0));
         double mid = ((hh + ll) / 2.0 + basis) / 2.0; mom = c[i] - mid;
        }
      if(i < AT24RL_FIRST) { sqzPrev = sqz; continue; }
      //--- signals
      if(c[i] > kama[i] && kama[i] > kama[i - 1]) sig[i * AT24RL_NR + 0] = 1; else if(c[i] < kama[i] && kama[i] < kama[i - 1]) sig[i * AT24RL_NR + 0] = -1;
      if(c[i] > fr[i] && fr[i] > fr[i - 1]) sig[i * AT24RL_NR + 1] = 1; else if(c[i] < fr[i] && fr[i] < fr[i - 1]) sig[i * AT24RL_NR + 1] = -1;
      if(c[i] > hma[i] && hma[i] > hma[i - 1]) sig[i * AT24RL_NR + 2] = 1; else if(c[i] < hma[i] && hma[i] < hma[i - 1]) sig[i * AT24RL_NR + 2] = -1;
      if(tsi[i] > tsg[i]) sig[i * AT24RL_NR + 3] = 1; else if(tsi[i] < tsg[i]) sig[i * AT24RL_NR + 3] = -1;
      double vp = 0.0, vm = 0.0, vt = 0.0;
      for(int j = i - 13; j <= i; j++) { vp += MathAbs(h[j] - l[j - 1]); vm += MathAbs(l[j] - h[j - 1]); vt += tr[j]; }
      double vip = (vt > 0.0) ? vp / vt : 0.0, vim = (vt > 0.0) ? vm / vt : 0.0;
      if(vip - vim > 1e-12) sig[i * AT24RL_NR + 4] = 1; else if(vip - vim < -1e-12) sig[i * AT24RL_NR + 4] = -1;       // 1e-12: a floating-point tie is no signal
      bool release = (!sqz) && sqzPrev;
      if(release && mom > 0.0) sig[i * AT24RL_NR + 5] = 1; else if(release && mom < 0.0) sig[i * AT24RL_NR + 5] = -1;
      sqzPrev = sqz;
     }
  }

//--- trades from index 'from': same engine as AT24SF_Run with 6 rules (30 cells)
void AT24RL_Run(const int n, const double &o[], const double &h[], const double &l[], const double &atr14[], const bool &valid[], const int &st[], const int &sig[],
                const double cost, const double stopAtr, const int from, AT24RL_Res &res)
  {
   double rv[];
   int total = 0;
   int cnt[AT24RL_NC]; ArrayInitialize(cnt, 0);
   int stp[AT24RL_NC]; ArrayInitialize(stp, 0);
   int i0 = MathMax(from, AT24RL_FIRST);
   for(int ph = 0; ph < 2; ph++)
     {
      int pos[AT24RL_NC]; ArrayInitialize(pos, 0);
      for(int r = 0; r < AT24RL_NR; r++)
        {
         int last = -1000000;
         for(int i = i0; i + AT24SF_HOLD + 1 <= n - 1; i++)
           {
            int d = sig[i * AT24RL_NR + r];
            if(d == 0 || !valid[i] || st[i] < 0 || atr14[i] <= 0.0) continue;
            if(i - last < AT24SF_HOLD) continue;
            last = i;
            int cell = r * AT24RA_K + st[i];
            if(ph == 0) { cnt[cell]++; total++; }
            else
              {
               double e0 = o[i + 1], pnl = d * (o[i + 1 + AT24SF_HOLD] - e0);
               if(stopAtr > 0.0)
                 {
                  double stopPx = e0 - d * stopAtr * atr14[i];
                  double tol = 1e-12 * MathMax(1.0, MathAbs(stopPx));     // a stop price equal to a bar extreme up to rounding counts as hit
                  for(int j = i + 1; j <= i + AT24SF_HOLD; j++)
                     if((d > 0 && l[j] <= stopPx + tol) || (d < 0 && h[j] >= stopPx - tol)) { pnl = d * (stopPx - e0); stp[cell]++; break; }
                 }
               double R = (pnl - cost) / atr14[i];
               int base = 0; for(int q = 0; q < cell; q++) base += cnt[q];
               rv[base + pos[cell]] = R; pos[cell]++;
              }
           }
        }
      if(ph == 0) ArrayResize(rv, MathMax(total, 1));
     }
   res.trades = total; res.stopped = 0;
   int base = 0;
   for(int cell = 0; cell < AT24RL_NC; cell++)
     {
      double tmp[]; ArrayResize(tmp, MathMax(cnt[cell], 1));
      for(int k = 0; k < cnt[cell]; k++) tmp[k] = rv[base + k];
      AT24SF_CellOf(tmp, cnt[cell], res.c[cell]);
      res.c[cell].nStop = stp[cell]; res.stopped += stp[cell];
      base += cnt[cell];
     }
  }

#endif
