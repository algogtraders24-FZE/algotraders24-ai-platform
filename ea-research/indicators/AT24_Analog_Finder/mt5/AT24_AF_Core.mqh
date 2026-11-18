//+------------------------------------------------------------------+
//| AT24_AF_Core.mqh - AT24 Analog Finder engine (pure functions)    |
//| Features of a closed H1 bar, analog search with separation, the  |
//| statistics of what followed, and the self-test on the symbol's   |
//| own history. Rules: SPEC.md. Chronological arrays.               |
//| Needs AT24_SF_Core.mqh (luck test AT24SF_CellOf).                |
//+------------------------------------------------------------------+
#ifndef AT24_AF_CORE_MQH
#define AT24_AF_CORE_MQH

#include "AT24_SF_Core.mqh"

#define AT24AF_NF     12
#define AT24AF_FIRST  250
#define AT24AF_FWD    24
#define AT24AF_K      30
#define AT24AF_SEP    24
#define AT24AF_MAXK   40

struct AT24AF_Stat
  {
   int    k;                 // analogs found
   double mean, q10, q25, q50, q75, q90;
   double shareUp;
   double meanDist;
   int    idx[AT24AF_MAXK];  // bar indices of the analogs (nearest first)
  };

struct AT24AF_Self
  {
   int    nTest;             // test points
   int    nSel;              // test points where the analogs agree (>= 60 % one side)
   double bandHeld;          // share of test points inside the 10 - 90 % band
   double hit, avgR, p;      // direction record on the selected points
   int    cls;               // AT24SF cell class of the direction record
   double alwaysLong;        // average outcome over all test points
   bool   ok;
  };

//--- features of every bar (row-major f[i * 12 + q]); ok[i] = features known, yok[i] = outcome known
void AT24AF_Series(const int n, const double &h[], const double &l[], const double &c[],
                   double &f[], double &atr14[], double &y[], bool &ok[], bool &yok[])
  {
   ArrayResize(f, n * AT24AF_NF); ArrayResize(atr14, n); ArrayResize(y, n); ArrayResize(ok, n); ArrayResize(yok, n);
   double tr[]; ArrayResize(tr, n);
   for(int i = 0; i < n; i++)
     {
      tr[i] = h[i] - l[i];
      if(i > 0) tr[i] = MathMax(tr[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
     }
   double s14 = 0.0, s100 = 0.0, up14 = 0.0, dn14 = 0.0, e20 = 0.0, e50 = 0.0, e200 = 0.0;
   for(int i = 0; i < n; i++)
     {
      s14 += tr[i]; if(i >= 14) s14 -= tr[i - 14];
      s100 += tr[i]; if(i >= 100) s100 -= tr[i - 100];
      if(i == 0) { e20 = c[0]; e50 = c[0]; e200 = c[0]; }
      else
        {
         e20 = (2.0 / 21.0) * c[i] + (1.0 - 2.0 / 21.0) * e20;
         e50 = (2.0 / 51.0) * c[i] + (1.0 - 2.0 / 51.0) * e50;
         e200 = (2.0 / 201.0) * c[i] + (1.0 - 2.0 / 201.0) * e200;
         double d = c[i] - c[i - 1];
         up14 += MathMax(d, 0.0); dn14 += MathMax(-d, 0.0);
         if(i >= 15) { double d0 = c[i - 14] - c[i - 15]; up14 -= MathMax(d0, 0.0); dn14 -= MathMax(-d0, 0.0); }
        }
      ok[i] = false; yok[i] = false; atr14[i] = 0.0; y[i] = 0.0;
      for(int q = 0; q < AT24AF_NF; q++) f[i * AT24AF_NF + q] = 0.0;
      if(i < AT24AF_FIRST) continue;
      double a14 = s14 / 14.0, a100 = s100 / 100.0;
      if(a14 <= 0.0 || a100 <= 0.0) continue;
      atr14[i] = a14;
      int lag[6] = {1, 3, 6, 12, 24, 48};
      for(int q = 0; q < 6; q++) f[i * AT24AF_NF + q] = (c[i] - c[i - lag[q]]) / a14;
      f[i * AT24AF_NF + 6] = MathLog(a14 / a100);
      double rsi = 100.0 - 100.0 / (1.0 + (up14 / 14.0) / ((dn14 / 14.0) + 1e-12));
      f[i * AT24AF_NF + 7] = (rsi - 50.0) / 25.0;
      f[i * AT24AF_NF + 8] = (c[i] - e20) / a14;
      f[i * AT24AF_NF + 9] = (c[i] - e50) / a14;
      f[i * AT24AF_NF + 10] = (c[i] - e200) / a14;
      double hh = h[i], ll = l[i];
      for(int j = i - 47; j < i; j++) { if(h[j] > hh) hh = h[j]; if(l[j] < ll) ll = l[j]; }
      f[i * AT24AF_NF + 11] = (c[i] - ll) / (hh - ll + 1e-12);
      ok[i] = true;
      if(i + AT24AF_FWD <= n - 1) { y[i] = (c[i + AT24AF_FWD] - c[i]) / a14; yok[i] = true; }
     }
  }

//--- mean / sd of every feature over rows 250 .. s that have a known outcome; returns false when fewer than 500 rows
bool AT24AF_Scale(const int n, const double &f[], const bool &ok[], const bool &yok[], double &mu[], double &sd[], int &sEnd)
  {
   ArrayResize(mu, AT24AF_NF); ArrayResize(sd, AT24AF_NF);
   sEnd = AT24AF_FIRST + (int)MathFloor(0.6 * (n - 1 - AT24AF_FWD - AT24AF_FIRST));
   int cnt = 0;
   for(int q = 0; q < AT24AF_NF; q++) { mu[q] = 0.0; sd[q] = 0.0; }
   for(int i = AT24AF_FIRST; i <= sEnd; i++)
     {
      if(!ok[i] || !yok[i]) continue;
      for(int q = 0; q < AT24AF_NF; q++) mu[q] += f[i * AT24AF_NF + q];
      cnt++;
     }
   if(cnt < 500) return false;
   for(int q = 0; q < AT24AF_NF; q++) mu[q] /= cnt;
   for(int i = AT24AF_FIRST; i <= sEnd; i++)
     {
      if(!ok[i] || !yok[i]) continue;
      for(int q = 0; q < AT24AF_NF; q++) { double d = f[i * AT24AF_NF + q] - mu[q]; sd[q] += d * d; }
     }
   for(int q = 0; q < AT24AF_NF; q++) sd[q] = MathSqrt(sd[q] / cnt) + 1e-12;
   return true;
  }

double AT24AF_Quant(const double &s[], const int m, const double p)
  {
   if(m <= 0) return 0.0;
   double pos = p * (m - 1);
   int lo = (int)MathFloor(pos); int hi = MathMin(lo + 1, m - 1);
   return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

//--- analogs of row q among candidate rows 250 .. last (rows with ok and yok): greedy by distance with a separation of 24 bars
void AT24AF_Search(const int q, const int last, const double &f[], const bool &ok[], const bool &yok[], const double &y[],
                   const double &mu[], const double &sd[], AT24AF_Stat &st)
  {
   st.k = 0; st.mean = 0.0; st.q10 = 0.0; st.q25 = 0.0; st.q50 = 0.0; st.q75 = 0.0; st.q90 = 0.0; st.shareUp = 0.0; st.meanDist = 0.0;
   double zq[AT24AF_NF];
   for(int a = 0; a < AT24AF_NF; a++) zq[a] = (f[q * AT24AF_NF + a] - mu[a]) / sd[a];
   int m = last + 1;
   double dist[]; ArrayResize(dist, m);
   for(int i = 0; i < m; i++)
     {
      if(i < AT24AF_FIRST || !ok[i] || !yok[i]) { dist[i] = DBL_MAX; continue; }
      double s = 0.0;
      for(int a = 0; a < AT24AF_NF; a++) { double d = (f[i * AT24AF_NF + a] - mu[a]) / sd[a] - zq[a]; s += d * d; }
      dist[i] = s;
     }
   double out[AT24AF_MAXK]; double sumD = 0.0;
   while(st.k < AT24AF_K)
     {
      int best = -1; double bd = DBL_MAX;
      for(int i = AT24AF_FIRST; i < m; i++) if(dist[i] < bd) { bd = dist[i]; best = i; }
      if(best < 0) break;
      st.idx[st.k] = best; out[st.k] = y[best]; sumD += MathSqrt(bd); st.k++;
      int a0 = MathMax(AT24AF_FIRST, best - AT24AF_SEP + 1), a1 = MathMin(m - 1, best + AT24AF_SEP - 1);
      for(int i = a0; i <= a1; i++) dist[i] = DBL_MAX;
     }
   if(st.k == 0) return;
   double v[]; ArrayResize(v, st.k);
   double s = 0.0; int up = 0;
   for(int i = 0; i < st.k; i++) { v[i] = out[i]; s += out[i]; if(out[i] > 0.0) up++; }
   ArraySort(v);
   st.mean = s / st.k; st.shareUp = (double)up / st.k; st.meanDist = sumD / st.k;
   st.q10 = AT24AF_Quant(v, st.k, 0.10); st.q25 = AT24AF_Quant(v, st.k, 0.25); st.q50 = AT24AF_Quant(v, st.k, 0.50);
   st.q75 = AT24AF_Quant(v, st.k, 0.75); st.q90 = AT24AF_Quant(v, st.k, 0.90);
  }

//--- the self-test of SPEC section 4
void AT24AF_SelfTest(const int n, const double &f[], const bool &ok[], const bool &yok[], const double &y[],
                     const double &mu[], const double &sd[], const int sEnd, AT24AF_Self &t)
  {
   t.nTest = 0; t.nSel = 0; t.bandHeld = 0.0; t.hit = 0.0; t.avgR = 0.0; t.p = 1.0; t.cls = 2; t.alwaysLong = 0.0; t.ok = false;
   double rv[]; ArrayResize(rv, MathMax(1, (n - sEnd) / AT24AF_FWD + 2));
   int held = 0, nr = 0; double sumAll = 0.0;
   for(int j = sEnd + 1; j <= n - 1 - AT24AF_FWD; j += AT24AF_FWD)
     {
      if(!ok[j] || !yok[j]) continue;
      AT24AF_Stat st; AT24AF_Search(j, j - AT24AF_FWD, f, ok, yok, y, mu, sd, st);
      if(st.k < 10) continue;
      t.nTest++; sumAll += y[j];
      if(y[j] >= st.q10 - 1e-12 && y[j] <= st.q90 + 1e-12) held++;
      if(st.shareUp >= 0.6 || st.shareUp <= 0.4)
        {
         double side = (st.shareUp >= 0.5) ? 1.0 : -1.0;
         rv[nr++] = side * y[j];
        }
     }
   if(t.nTest == 0) return;
   t.bandHeld = (double)held / t.nTest; t.alwaysLong = sumAll / t.nTest; t.nSel = nr;
   AT24SF_Cell cell; AT24SF_CellOf(rv, nr, cell);
   t.hit = cell.hit; t.avgR = cell.avg; t.p = cell.p; t.cls = cell.cls; t.ok = true;
  }

#endif
