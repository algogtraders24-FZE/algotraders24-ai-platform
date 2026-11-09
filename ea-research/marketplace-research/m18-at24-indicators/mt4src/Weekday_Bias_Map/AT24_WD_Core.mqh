//+------------------------------------------------------------------+
//| AT24_WD_Core.mqh                                                 |
//| Does the daily return depend on the weekday? Mean return per     |
//| weekday, t-statistics, a chance check across the weekdays and    |
//| whether the pattern of the first half of the history held in the |
//| second half. Pure maths. Caller supplies daily log returns and   |
//| the weekday (0 = Sunday .. 6 = Saturday) of each candle.         |
//+------------------------------------------------------------------+
#ifndef AT24_WD_CORE_MQH
#define AT24_WD_CORE_MQH

#define AT24WD_COLS 7    // per weekday: n, mean (bp), t-stat, % up, first-half mean (bp), second-half mean (bp), std (bp)

//--- only weekdays 1..5 (Monday..Friday) with at least 30 candles are evaluated; other days are left at zero.
//--- sum[0] weekdays with |t| >= 1.96, sum[1] weekdays with |t| >= 2.58 (Bonferroni for 5 weekdays),
//--- sum[2] Pearson correlation of first-half and second-half means over the evaluated weekdays, sum[3] weekdays with the same sign in both halves and overall,
//--- sum[4] number of evaluated weekdays
void AT24WD_Stats(const int n, const double &ret[], const int &dow[], double &out[], double &sum[])
  {
   ArrayResize(out, 7 * AT24WD_COLS); ArrayResize(sum, 5);
   for(int z = 0; z < 7 * AT24WD_COLS; z++) out[z] = 0.0;
   for(int z = 0; z < 5; z++) sum[z] = 0.0;
   double s[7], s2[7], sa[7], sb[7]; int c[7], up[7], ca[7], cb[7]; ArrayInitialize(s, 0.0); ArrayInitialize(s2, 0.0); ArrayInitialize(sa, 0.0); ArrayInitialize(sb, 0.0); ArrayInitialize(c, 0); ArrayInitialize(up, 0); ArrayInitialize(ca, 0); ArrayInitialize(cb, 0);
   for(int d = 0; d < 7; d++) { s[d] = 0.0; s2[d] = 0.0; sa[d] = 0.0; sb[d] = 0.0; c[d] = 0; up[d] = 0; ca[d] = 0; cb[d] = 0; }
   int half = n / 2;
   for(int i = 0; i < n; i++)
     {
      int d = dow[i];
      if(d < 0 || d > 6) continue;
      s[d] += ret[i]; s2[d] += ret[i] * ret[i]; c[d]++;
      if(ret[i] > 0.0) up[d]++;
      if(i < half) { sa[d] += ret[i]; ca[d]++; } else { sb[d] += ret[i]; cb[d]++; }
     }
   double ma[7], mb[7]; int agree = 0, used = 0; ArrayInitialize(ma, 0.0); ArrayInitialize(mb, 0.0);
   for(int d = 0; d < 7; d++) { ma[d] = 0.0; mb[d] = 0.0; }
   for(int d = 1; d <= 5; d++)
     {
      if(c[d] < 30) continue;
      used++;
      ma[d] = ca[d] > 0 ? sa[d] / ca[d] : 0.0; mb[d] = cb[d] > 0 ? sb[d] / cb[d] : 0.0;
      double mean = s[d] / c[d];
      double var = (s2[d] - c[d] * mean * mean) / (c[d] - 1);
      double sd = MathSqrt(MathMax(var, 0.0));
      double t = (sd > 0.0) ? mean / (sd / MathSqrt((double)c[d])) : 0.0;
      out[d * AT24WD_COLS + 0] = c[d];
      out[d * AT24WD_COLS + 1] = mean * 1e4;
      out[d * AT24WD_COLS + 2] = t;
      out[d * AT24WD_COLS + 3] = 100.0 * up[d] / c[d];
      out[d * AT24WD_COLS + 4] = ma[d] * 1e4;
      out[d * AT24WD_COLS + 5] = mb[d] * 1e4;
      out[d * AT24WD_COLS + 6] = sd * 1e4;
      if(MathAbs(t) >= 1.96) sum[0] += 1.0;
      if(MathAbs(t) >= 2.58) sum[1] += 1.0;
      if(mean != 0.0 && ma[d] != 0.0 && mb[d] != 0.0 && ((mean > 0.0) == (ma[d] > 0.0)) && ((mean > 0.0) == (mb[d] > 0.0))) agree++;
     }
   double xa = 0.0, xb = 0.0; int k = 0;
   for(int d = 1; d <= 5; d++) if(c[d] >= 30) { xa += ma[d]; xb += mb[d]; k++; }
   if(k > 1)
     {
      xa /= k; xb /= k;
      double sxy = 0.0, sxx = 0.0, syy = 0.0;
      for(int d = 1; d <= 5; d++) if(c[d] >= 30) { double a = ma[d] - xa, b = mb[d] - xb; sxy += a * b; sxx += a * a; syy += b * b; }
      sum[2] = (sxx > 0.0 && syy > 0.0) ? sxy / MathSqrt(sxx * syy) : 0.0;
     }
   sum[3] = agree; sum[4] = used;
  }

#endif // AT24_WD_CORE_MQH
