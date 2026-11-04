//+------------------------------------------------------------------+
//| AT24_VF_Core.mqh                                                 |
//| Volatility estimators from OHLC bars, EWMA forecasts, and a      |
//| calibration study: how well did each forecast track the volatility|
//| that really followed?                                            |
//| Closed bars only. Pure maths, chronological arrays.              |
//+------------------------------------------------------------------+
#ifndef AT24_VF_CORE_MQH
#define AT24_VF_CORE_MQH

#define AT24VF_EST 4     // 0 close-to-close, 1 Parkinson, 2 Garman-Klass, 3 Rogers-Satchell

//--- per-bar variance of the log price for each estimator (index 0 has no previous close: 0)
void AT24VF_PerBar(const int n, const double &o[], const double &h[], const double &l[], const double &c[], double &v0[], double &v1[], double &v2[], double &v3[])
  {
   ArrayResize(v0, n); ArrayResize(v1, n); ArrayResize(v2, n); ArrayResize(v3, n);
   double k2 = 2.0 * MathLog(2.0) - 1.0, p = 1.0 / (4.0 * MathLog(2.0));
   for(int i = 0; i < n; i++)
     {
      double hl = MathLog(h[i] / l[i]), co = MathLog(c[i] / o[i]);
      v1[i] = p * hl * hl;
      v2[i] = 0.5 * hl * hl - k2 * co * co;
      v3[i] = MathLog(h[i] / c[i]) * MathLog(h[i] / o[i]) + MathLog(l[i] / c[i]) * MathLog(l[i] / o[i]);
      if(i == 0) v0[i] = 0.0; else { double r = MathLog(c[i] / c[i - 1]); v0[i] = r * r; }
     }
  }

//--- EWMA of per-bar variance: s2[i] = lam*s2[i-1] + (1-lam)*v[i]; starts at bar `warm` with the mean of v[1..warm]
//--- returns per-bar sigma (sqrt); sigma[i] = 0 before the start. Negative variances (estimator noise) are floored at 0.
void AT24VF_Ewma(const int n, const double &v[], const double lam, const int warm, double &sig[])
  {
   ArrayResize(sig, n);
   for(int i = 0; i < n; i++) sig[i] = 0.0;
   if(n <= warm) return;
   double s2 = 0.0;
   for(int i = 1; i <= warm; i++) s2 += MathMax(v[i], 0.0);
   s2 /= warm;
   sig[warm] = MathSqrt(s2);
   for(int i = warm + 1; i < n; i++)
     {
      s2 = lam * s2 + (1.0 - lam) * MathMax(v[i], 0.0);
      sig[i] = MathSqrt(s2);
     }
  }

//--- ATR (Wilder) of closed bars divided by close = a per-bar range-based volatility proxy
void AT24VF_AtrPct(const int n, const double &h[], const double &l[], const double &c[], const int len, double &out[])
  {
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = 0.0;
   double atr = 0.0, sum = 0.0;
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? h[0] - l[0] : MathMax(h[i] - l[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
      if(i < len) { sum += tr; if(i == len - 1) { atr = sum / len; out[i] = atr / c[i]; } }
      else { atr = (atr * (len - 1) + tr) / len; out[i] = atr / c[i]; }
     }
  }

//--- naive forecast: close-to-close sigma of the previous H bars
void AT24VF_Naive(const int n, const double &v0[], const int H, double &out[])
  {
   ArrayResize(out, n);
   for(int i = 0; i < n; i++) out[i] = 0.0;
   for(int i = H; i < n; i++)
     {
      double s = 0.0;
      for(int j = i - H + 1; j <= i; j++) s += v0[j];
      out[i] = MathSqrt(s / H);
     }
  }

//--- calibration: at bar t (step H, from `start`), forecast f[t] vs the close-to-close sigma realized over bars t+1..t+H.
//--- out[0] samples, [1] Pearson correlation of ln(forecast) and ln(realized), [2] median realized/forecast (bias),
//--- [3] % of samples with realized within +-30 % of the forecast
void AT24VF_Calib(const int n, const double &f[], const double &v0[], const int H, const int start, double &out[])
  {
   ArrayResize(out, 4);
   for(int z = 0; z < 4; z++) out[z] = 0.0;
   double lf[], lr[], ratio[]; int m = 0, ok30 = 0;
   ArrayResize(lf, 0); ArrayResize(lr, 0); ArrayResize(ratio, 0);
   for(int t = start; t + H < n; t += H)
     {
      if(f[t] <= 0.0) continue;
      double s = 0.0;
      for(int j = t + 1; j <= t + H; j++) s += v0[j];
      double real = MathSqrt(s / H);
      if(real <= 0.0) continue;
      ArrayResize(lf, m + 1); ArrayResize(lr, m + 1); ArrayResize(ratio, m + 1);
      lf[m] = MathLog(f[t]); lr[m] = MathLog(real); ratio[m] = real / f[t];
      if(MathAbs(real / f[t] - 1.0) <= 0.30) ok30++;
      m++;
     }
   out[0] = m;
   if(m < 3) return;
   double mf = 0.0, mr = 0.0;
   for(int i = 0; i < m; i++) { mf += lf[i]; mr += lr[i]; }
   mf /= m; mr /= m;
   double sxy = 0.0, sxx = 0.0, syy = 0.0;
   for(int i = 0; i < m; i++) { double a = lf[i] - mf, b = lr[i] - mr; sxy += a * b; sxx += a * a; syy += b * b; }
   out[1] = (sxx > 0.0 && syy > 0.0) ? sxy / MathSqrt(sxx * syy) : 0.0;
   ArraySort(ratio);
   out[2] = (m % 2 == 1) ? ratio[m / 2] : 0.5 * (ratio[m / 2 - 1] + ratio[m / 2]);
   out[3] = 100.0 * ok30 / m;
  }

//--- intraday-seasonal EWMA forecast. Volatility has a strong time-of-day pattern (Asia quiet, London/New York busy), so a plain
//--- EWMA lags every session change. Here the per-bar variance is divided by the average variance seen so far in the same
//--- time-of-day slot (relative to the overall average; only PAST bars are used), the EWMA runs on that de-seasonalised series,
//--- and the forecast for the next H bars multiplies the level by the average seasonal factor of those H slots.
//--- lvl[i] = sqrt(level / mean variance): current volatility regime relative to its long-run average with the time of day removed (1.0 = normal). slot[i] = time-of-day slot of bar i (0..S-1). fH[t] = forecast per-bar sigma for bars t+1..t+H (0 before `warm`).
void AT24VF_Seasonal(const int n, const int &slot[], const int S, const double &v[], const double lam, const int warm, const int H, double &fH[], double &lvl[])
  {
   ArrayResize(fH, n); ArrayResize(lvl, n);
   for(int i = 0; i < n; i++) { fH[i] = 0.0; lvl[i] = 0.0; }
   if(n <= warm + 1) return;
   double sum[]; int cnt[]; ArrayResize(sum, S); ArrayResize(cnt, S);
   for(int k = 0; k < S; k++) { sum[k] = 0.0; cnt[k] = 0; }
   double tot = 0.0; int totc = 0, active = 0;
   double level = 0.0;
   for(int i = 1; i < n; i++)
     {
      double vi = MathMax(v[i], 0.0);
      //--- seasonal factor of bar i from bars before i
      double mean = (totc > 0) ? tot / totc : 0.0;
      double f = 1.0;
      if(cnt[slot[i]] >= 3 && mean > 0.0) f = (sum[slot[i]] / cnt[slot[i]]) / mean;
      if(f <= 1e-9) f = 1.0;
      double d = vi / f;
      if(i <= warm) { level += d; if(i == warm) level /= warm; }
      else level = lam * level + (1.0 - lam) * d;
      sum[slot[i]] += vi; cnt[slot[i]]++; tot += vi; totc++;
      if(i >= warm && tot > 0.0) lvl[i] = MathSqrt(MathMax(level, 0.0) / (tot / totc));   // volatility regime vs its long-run average, time of day removed (1.0 = normal)
      if(i >= warm)
        {
         double m2 = tot / totc, acc = 0.0;
         for(int j = 1; j <= H; j++)
           {
            int sl = (slot[i] + j) % S;
            double fj = 1.0;
            if(cnt[sl] >= 3 && m2 > 0.0) fj = (sum[sl] / cnt[sl]) / m2;
            if(fj <= 1e-9) fj = 1.0;
            acc += fj;
           }
         fH[i] = MathSqrt(MathMax(level, 0.0) * acc / H);
        }
     }
  }

//--- percentile (0-100) of x among the last `look` non-zero values of s[] ending at bar `end`
double AT24VF_Percentile(const double &s[], const int end, const int look, const double x)
  {
   int cnt = 0, below = 0;
   for(int i = MathMax(0, end - look + 1); i <= end; i++)
     {
      if(s[i] <= 0.0) continue;
      cnt++;
      if(s[i] < x) below++;
     }
   return cnt > 0 ? 100.0 * below / cnt : 0.0;
  }

#endif // AT24_VF_CORE_MQH
