//+------------------------------------------------------------------+
//| AT24_HB_Core.mqh                                                 |
//| Does the direction of price depend on the hour of the day?       |
//| Mean return per hour, t-statistics, how many hours look          |
//| "significant" against what chance alone gives, and whether the   |
//| pattern of the first half of the history held in the second half.|
//| Pure maths. The caller supplies hourly log returns and the hour. |
//+------------------------------------------------------------------+
#ifndef AT24_HB_CORE_MQH
#define AT24_HB_CORE_MQH

#define AT24HB_COLS 8    // per hour: n, mean (bp), t-stat, % up, mean first half (bp), mean second half (bp), std (bp), spare

//--- ret[]: log return of each hourly bar, hr[]: hour 0..23 of that bar (the same clock for all bars), chronological.
//--- out[h*8 + k]: 0 n, 1 mean in basis points, 2 t-stat (mean / (std / sqrt n)), 3 % of bars up, 4 mean of the first half of the history,
//--- 5 mean of the second half, 6 std in bp. sum[0] hours with |t| >= 1.96, sum[1] hours with |t| >= 3.0 (Bonferroni for 24 hours),
//--- sum[2] Pearson correlation of the 24 first-half means with the 24 second-half means, sum[3] hours where both halves have the same sign as the whole
void AT24HB_Stats(const int n, const double &ret[], const int &hr[], double &out[], double &sum[])
  {
   ArrayResize(out, 24 * AT24HB_COLS); ArrayResize(sum, 4);
   for(int z = 0; z < 24 * AT24HB_COLS; z++) out[z] = 0.0;
   for(int z = 0; z < 4; z++) sum[z] = 0.0;
   double s[24], s2[24], sa[24], sb[24]; int c[24], up[24], ca[24], cb[24];
   ArrayInitialize(s, 0.0); ArrayInitialize(s2, 0.0); ArrayInitialize(sa, 0.0); ArrayInitialize(sb, 0.0); ArrayInitialize(c, 0); ArrayInitialize(up, 0); ArrayInitialize(ca, 0); ArrayInitialize(cb, 0);
   for(int h = 0; h < 24; h++) { s[h] = 0.0; s2[h] = 0.0; sa[h] = 0.0; sb[h] = 0.0; c[h] = 0; up[h] = 0; ca[h] = 0; cb[h] = 0; }
   int half = n / 2;
   for(int i = 0; i < n; i++)
     {
      int h = hr[i];
      if(h < 0 || h > 23) continue;
      s[h] += ret[i]; s2[h] += ret[i] * ret[i]; c[h]++;
      if(ret[i] > 0.0) up[h]++;
      if(i < half) { sa[h] += ret[i]; ca[h]++; } else { sb[h] += ret[i]; cb[h]++; }
     }
   double ma[24], mb[24]; int agree = 0; ArrayInitialize(ma, 0.0); ArrayInitialize(mb, 0.0);
   for(int h = 0; h < 24; h++)
     {
      ma[h] = ca[h] > 0 ? sa[h] / ca[h] : 0.0; mb[h] = cb[h] > 0 ? sb[h] / cb[h] : 0.0;
      if(c[h] < 3) continue;
      double mean = s[h] / c[h];
      double var = (s2[h] - c[h] * mean * mean) / (c[h] - 1);
      double sd = MathSqrt(MathMax(var, 0.0));
      double t = (sd > 0.0) ? mean / (sd / MathSqrt((double)c[h])) : 0.0;
      out[h * AT24HB_COLS + 0] = c[h];
      out[h * AT24HB_COLS + 1] = mean * 1e4;
      out[h * AT24HB_COLS + 2] = t;
      out[h * AT24HB_COLS + 3] = 100.0 * up[h] / c[h];
      out[h * AT24HB_COLS + 4] = ma[h] * 1e4;
      out[h * AT24HB_COLS + 5] = mb[h] * 1e4;
      out[h * AT24HB_COLS + 6] = sd * 1e4;
      if(MathAbs(t) >= 1.96) sum[0] += 1.0;
      if(MathAbs(t) >= 3.0) sum[1] += 1.0;
      if(mean != 0.0 && ma[h] != 0.0 && mb[h] != 0.0 && ((mean > 0.0) == (ma[h] > 0.0)) && ((mean > 0.0) == (mb[h] > 0.0))) agree++;
     }
   double xa = 0.0, xb = 0.0;
   for(int h = 0; h < 24; h++) { xa += ma[h]; xb += mb[h]; }
   xa /= 24.0; xb /= 24.0;
   double sxy = 0.0, sxx = 0.0, syy = 0.0;
   for(int h = 0; h < 24; h++) { double a = ma[h] - xa, b = mb[h] - xb; sxy += a * b; sxx += a * a; syy += b * b; }
   sum[2] = (sxx > 0.0 && syy > 0.0) ? sxy / MathSqrt(sxx * syy) : 0.0;
   sum[3] = agree;
  }

#endif // AT24_HB_CORE_MQH
