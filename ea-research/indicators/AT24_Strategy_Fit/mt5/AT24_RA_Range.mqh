//+------------------------------------------------------------------+
//| AT24_RA_Range.mqh - expected next-24-hour range (SPEC section 9) |
//| Ridge regression of ln(next 24 h range / price) on ATR levels   |
//| and the hour-of-day pattern, fitted on the chart symbol's own    |
//| H1 history, with an empirical 80 % band and an out-of-sample     |
//| coverage check. Pure functions, chronological arrays.            |
//+------------------------------------------------------------------+
#ifndef AT24_RA_RANGE_MQH
#define AT24_RA_RANGE_MQH

#define AT24RR_NF     4        // features: ln ATR14/C, ln ATR24/C, ln ATR120/C, hour-of-day mean of y
#define AT24RR_FIRST  150
#define AT24RR_FWD    24
#define AT24RR_LAMBDA 1.0
#define AT24RR_MINTR  1500     // fewest training rows

struct AT24RR_Out
  {
   bool   ok;
   double pred;                 // ln of the predicted range / price
   double q10, q50, q90;        // residual quantiles
   double mid, lo, hi;          // price units: C * exp(pred + q50 / q10 / q90)
   double midPct, loPct, hiPct; // the same in percent of the price
   double cover;                // share of the test rows inside [pred + q10, pred + q90]
   int    nCover;               // test rows
   int    nTrain;
  };

//--- linear interpolation quantile of a sorted array (numpy default)
double AT24RR_Quant(const double &s[], const int m, const double p)
  {
   if(m <= 0) return 0.0;
   double pos = p * (m - 1);
   int lo = (int)MathFloor(pos); int hi = MathMin(lo + 1, m - 1);
   double fr = pos - lo;
   return s[lo] + (s[hi] - s[lo]) * fr;
  }

//--- solve A x = b (A is k x k, row-major) by Gaussian elimination with partial pivoting; false when singular
bool AT24RR_Solve(const int k, const double &A_in[], const double &b_in[], double &x[])
  {
   double A[], b[]; ArrayResize(A, k * k); ArrayResize(b, k); ArrayResize(x, k);
   for(int i = 0; i < k * k; i++) A[i] = A_in[i];
   for(int i = 0; i < k; i++) b[i] = b_in[i];
   for(int c = 0; c < k; c++)
     {
      int piv = c; double best = MathAbs(A[c * k + c]);
      for(int r = c + 1; r < k; r++) if(MathAbs(A[r * k + c]) > best) { best = MathAbs(A[r * k + c]); piv = r; }
      if(best < 1e-14) return false;
      if(piv != c)
        {
         for(int j = 0; j < k; j++) { double tmp = A[c * k + j]; A[c * k + j] = A[piv * k + j]; A[piv * k + j] = tmp; }
         double tb = b[c]; b[c] = b[piv]; b[piv] = tb;
        }
      for(int r = c + 1; r < k; r++)
        {
         double f = A[r * k + c] / A[c * k + c];
         for(int j = c; j < k; j++) A[r * k + j] -= f * A[c * k + j];
         b[r] -= f * b[c];
        }
     }
   for(int i = k - 1; i >= 0; i--)
     {
      double s = b[i];
      for(int j = i + 1; j < k; j++) s -= A[i * k + j] * x[j];
      x[i] = s / A[i * k + i];
     }
   return true;
  }

int AT24RR_Hour(const datetime t) { return (int)(((long)t % 86400) / 3600); }

//--- per-bar features (valid from AT24RR_FIRST) and the forward target y = ln(range of the next 24 bars / C); ok[i] = features known, yok[i] = target known
void AT24RR_Series(const int n, const double &h[], const double &l[], const double &c[],
                   double &la14[], double &la24[], double &la120[], double &y[], bool &ok[], bool &yok[])
  {
   ArrayResize(la14, n); ArrayResize(la24, n); ArrayResize(la120, n); ArrayResize(y, n); ArrayResize(ok, n); ArrayResize(yok, n);
   double tr[]; ArrayResize(tr, n);
   for(int i = 0; i < n; i++)
     {
      tr[i] = h[i] - l[i];
      if(i > 0) tr[i] = MathMax(tr[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
     }
   double s14 = 0.0, s24 = 0.0, s120 = 0.0;
   for(int i = 0; i < n; i++)
     {
      s14 += tr[i]; if(i >= 14) s14 -= tr[i - 14];
      s24 += tr[i]; if(i >= 24) s24 -= tr[i - 24];
      s120 += tr[i]; if(i >= 120) s120 -= tr[i - 120];
      ok[i] = false; yok[i] = false; la14[i] = 0.0; la24[i] = 0.0; la120[i] = 0.0; y[i] = 0.0;
      if(i < AT24RR_FIRST || c[i] <= 0.0) continue;
      double a14 = s14 / 14.0, a24 = s24 / 24.0, a120 = s120 / 120.0;
      if(a14 <= 0.0 || a24 <= 0.0 || a120 <= 0.0) continue;
      la14[i] = MathLog(a14 / c[i]); la24[i] = MathLog(a24 / c[i]); la120[i] = MathLog(a120 / c[i]);
      ok[i] = true;
      if(i + AT24RR_FWD <= n - 1)
        {
         double hh = h[i + 1], ll = l[i + 1];
         for(int j = i + 2; j <= i + AT24RR_FWD; j++) { if(h[j] > hh) hh = h[j]; if(l[j] < ll) ll = l[j]; }
         double fr = (hh - ll) / c[i];
         if(fr > 0.0) { y[i] = MathLog(fr); yok[i] = true; }
        }
     }
  }

//--- fit on rows a..b (inclusive, only rows with ok and yok); returns the model pieces
struct AT24RR_Model
  {
   bool   ok;
   double sea[24];
   double ymean;
   double mean[AT24RR_NF], sd[AT24RR_NF], w[AT24RR_NF];
   double q10, q50, q90;
   int    n;
  };

void AT24RR_Fit(const int a, const int b, const datetime &t[], const double &la14[], const double &la24[], const double &la120[], const double &y[],
                const bool &ok[], const bool &yok[], AT24RR_Model &m)
  {
   m.ok = false; m.n = 0; m.q10 = 0.0; m.q50 = 0.0; m.q90 = 0.0; m.ymean = 0.0;
   double hs[24]; int hc[24]; ArrayInitialize(hs, 0.0); ArrayInitialize(hc, 0);
   double ys = 0.0; int cnt = 0;
   for(int i = a; i <= b; i++)
     {
      if(!ok[i] || !yok[i]) continue;
      int hr = AT24RR_Hour(t[i]); hs[hr] += y[i]; hc[hr]++; ys += y[i]; cnt++;
     }
   if(cnt < AT24RR_MINTR) return;
   m.n = cnt; m.ymean = ys / cnt;
   for(int hr = 0; hr < 24; hr++) m.sea[hr] = (hc[hr] > 0) ? hs[hr] / hc[hr] : m.ymean;
   //--- feature matrix of the training rows
   double X[]; double yy[]; ArrayResize(X, cnt * AT24RR_NF); ArrayResize(yy, cnt);
   int r = 0;
   for(int i = a; i <= b; i++)
     {
      if(!ok[i] || !yok[i]) continue;
      X[r * AT24RR_NF + 0] = la14[i]; X[r * AT24RR_NF + 1] = la24[i]; X[r * AT24RR_NF + 2] = la120[i]; X[r * AT24RR_NF + 3] = m.sea[AT24RR_Hour(t[i])];
      yy[r] = y[i]; r++;
     }
   for(int q = 0; q < AT24RR_NF; q++)
     {
      double s = 0.0; for(int k = 0; k < cnt; k++) s += X[k * AT24RR_NF + q];
      m.mean[q] = s / cnt;
      double v = 0.0; for(int k = 0; k < cnt; k++) { double d = X[k * AT24RR_NF + q] - m.mean[q]; v += d * d; }
      m.sd[q] = MathSqrt(v / cnt) + 1e-12;
     }
   double A[], bv[], wv[]; ArrayResize(A, AT24RR_NF * AT24RR_NF); ArrayResize(bv, AT24RR_NF);
   ArrayInitialize(A, 0.0); ArrayInitialize(bv, 0.0);
   for(int k = 0; k < cnt; k++)
     {
      double z[AT24RR_NF];
      for(int q = 0; q < AT24RR_NF; q++) z[q] = (X[k * AT24RR_NF + q] - m.mean[q]) / m.sd[q];
      for(int p1 = 0; p1 < AT24RR_NF; p1++)
        {
         bv[p1] += z[p1] * (yy[k] - m.ymean);
         for(int p2 = 0; p2 < AT24RR_NF; p2++) A[p1 * AT24RR_NF + p2] += z[p1] * z[p2];
        }
     }
   for(int p1 = 0; p1 < AT24RR_NF; p1++) A[p1 * AT24RR_NF + p1] += AT24RR_LAMBDA;
   if(!AT24RR_Solve(AT24RR_NF, A, bv, wv)) return;
   for(int q = 0; q < AT24RR_NF; q++) m.w[q] = wv[q];
   //--- residual quantiles on the training rows
   double res[]; ArrayResize(res, cnt);
   for(int k = 0; k < cnt; k++)
     {
      double p = m.ymean;
      for(int q = 0; q < AT24RR_NF; q++) p += ((X[k * AT24RR_NF + q] - m.mean[q]) / m.sd[q]) * m.w[q];
      res[k] = yy[k] - p;
     }
   ArraySort(res);
   m.q10 = AT24RR_Quant(res, cnt, 0.10); m.q50 = AT24RR_Quant(res, cnt, 0.50); m.q90 = AT24RR_Quant(res, cnt, 0.90);
   m.ok = true;
  }

double AT24RR_Predict(const AT24RR_Model &m, const int i, const datetime &t[], const double &la14[], const double &la24[], const double &la120[])
  {
   double x[AT24RR_NF];
   x[0] = la14[i]; x[1] = la24[i]; x[2] = la120[i]; x[3] = m.sea[AT24RR_Hour(t[i])];
   double p = m.ymean;
   for(int q = 0; q < AT24RR_NF; q++) p += ((x[q] - m.mean[q]) / m.sd[q]) * m.w[q];
   return p;
  }

//--- the whole thing for the last bar (index n-1): fit on rows from..n-1-24 (final model), test coverage with a model fitted on the first 70 %
void AT24RR_Run(const int n, const int from, const datetime &t[], const double &h[], const double &l[], const double &c[], AT24RR_Out &o)
  {
   o.ok = false; o.pred = 0.0; o.q10 = 0.0; o.q50 = 0.0; o.q90 = 0.0; o.mid = 0.0; o.lo = 0.0; o.hi = 0.0; o.midPct = 0.0; o.loPct = 0.0; o.hiPct = 0.0; o.cover = 0.0; o.nCover = 0; o.nTrain = 0;
   double la14[], la24[], la120[], y[]; bool ok[], yok[];
   AT24RR_Series(n, h, l, c, la14, la24, la120, y, ok, yok);
   int a = MathMax(from, AT24RR_FIRST), last = n - 1;
   if(!ok[last]) return;
   int b = n - 1 - AT24RR_FWD;                      // last row with a known target
   if(b <= a) return;
   AT24RR_Model fin; AT24RR_Fit(a, b, t, la14, la24, la120, y, ok, yok, fin);
   if(!fin.ok) return;
   //--- out-of-sample coverage: fit on the first 70 % (minus a 48-bar gap), test on the rest
   int s = a + (int)(0.7 * (b - a));
   AT24RR_Model tr; AT24RR_Fit(a, s - 48, t, la14, la24, la120, y, ok, yok, tr);
   if(tr.ok)
     {
      int inn = 0, m = 0;
      for(int i = s; i <= b; i++)
        {
         if(!ok[i] || !yok[i]) continue;
         double p = AT24RR_Predict(tr, i, t, la14, la24, la120);
         m++; if(y[i] >= p + tr.q10 - 1e-12 && y[i] <= p + tr.q90 + 1e-12) inn++;
        }
      o.nCover = m; o.cover = (m > 0) ? (double)inn / m : 0.0;
     }
   o.pred = AT24RR_Predict(fin, last, t, la14, la24, la120);
   o.q10 = fin.q10; o.q50 = fin.q50; o.q90 = fin.q90; o.nTrain = fin.n;
   double px = c[last];
   o.mid = px * MathExp(o.pred + o.q50); o.lo = px * MathExp(o.pred + o.q10); o.hi = px * MathExp(o.pred + o.q90);
   o.midPct = o.mid / px * 100.0; o.loPct = o.lo / px * 100.0; o.hiPct = o.hi / px * 100.0;
   o.ok = true;
  }

#endif
