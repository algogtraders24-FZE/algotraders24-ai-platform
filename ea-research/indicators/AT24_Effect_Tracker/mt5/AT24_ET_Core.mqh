//+------------------------------------------------------------------+
//| AT24_ET_Core.mqh                                                 |
//| Are hour-of-day effects ALIVE? For each New York hour: the mean  |
//| return and t-statistic over the most recent window, the same for |
//| the window before, a status (alive / newborn / died / none) and  |
//| the most likely change point of the hour's mean. Pure maths.     |
//+------------------------------------------------------------------+
#ifndef AT24_ET_CORE_MQH
#define AT24_ET_CORE_MQH

#define AT24ET_ALIVE   1
#define AT24ET_BORN    2
#define AT24ET_DIED    3
#define AT24ET_NONE    0

struct AT24ET_Hour
  {
   int    hour;
   int    nR;        // bars in the recent window
   double meanR;     // mean return, bp
   double tR;
   int    nP;        // bars in the previous window
   double meanP;
   double tP;
   int    status;
   int    cpIdx;     // change point: index (within this hour's last 3 windows) after which the mean is different (-1 none)
   int    cpBar;     // bar index of the change point in the input arrays
   double meanBefore;
   double meanAfter;
   double cpStat;    // |S_k*| / (sd * sqrt(m)): larger = clearer change
  };

//--- ret[]: hourly log return of each bar, hr[]: New York hour 0..23, day[]: trading-day number (non-decreasing). recent = days per window.
//--- Recent window = bars whose day >= lastDay - recent + 1; previous window = the `recent` days before that. tStat threshold `thr` (default 2.0).
//--- sum[0] hours with |tR| >= thr, [1] expected by chance (24 * 0.0455), [2] alive, [3] newborn, [4] died
void AT24ET_Analyze(const int n, const double &ret[], const int &hr[], const int &day[], const int recent, const double thr, AT24ET_Hour &out[], double &sum[])
  {
   ArrayResize(out, 24); ArrayResize(sum, 5);
   for(int z = 0; z < 5; z++) sum[z] = 0.0;
   int lastDay = day[n - 1];
   int r0 = lastDay - recent + 1, p0 = r0 - recent, a0 = r0 - 3 * recent;     // recent window start, previous window start, change-point history start
   for(int h = 0; h < 24; h++)
     {
      AT24ET_Hour o;
      o.hour = h; o.nR = 0; o.meanR = 0; o.tR = 0; o.nP = 0; o.meanP = 0; o.tP = 0; o.status = AT24ET_NONE; o.cpIdx = -1; o.cpBar = -1; o.meanBefore = 0; o.meanAfter = 0; o.cpStat = 0;
      double sR = 0, s2R = 0, sP = 0, s2P = 0;
      int hist[]; ArrayResize(hist, 0); int m = 0;
      for(int i = 0; i < n; i++)
        {
         if(hr[i] != h) continue;
         int d = day[i];
         if(d >= r0) { o.nR++; sR += ret[i]; s2R += ret[i] * ret[i]; }
         else if(d >= p0) { o.nP++; sP += ret[i]; s2P += ret[i] * ret[i]; }
         if(d >= a0) { ArrayResize(hist, m + 1); hist[m] = i; m++; }
        }
      if(o.nR >= 30)
        {
         double mean = sR / o.nR, var = (s2R - o.nR * mean * mean) / (o.nR - 1), sd = MathSqrt(MathMax(var, 0.0));
         o.meanR = mean * 1e4; o.tR = sd > 0 ? mean / (sd / MathSqrt((double)o.nR)) : 0.0;
        }
      if(o.nP >= 30)
        {
         double mean = sP / o.nP, var = (s2P - o.nP * mean * mean) / (o.nP - 1), sd = MathSqrt(MathMax(var, 0.0));
         o.meanP = mean * 1e4; o.tP = sd > 0 ? mean / (sd / MathSqrt((double)o.nP)) : 0.0;
        }
      bool sigR = (o.nR >= 30 && MathAbs(o.tR) >= thr), sigP = (o.nP >= 30 && MathAbs(o.tP) >= thr);
      if(sigR && sigP && o.tR * o.tP > 0) o.status = AT24ET_ALIVE;
      else if(sigR) o.status = AT24ET_BORN;
      else if(sigP) o.status = AT24ET_DIED;
      if(sigR) sum[0] += 1.0;
      if(o.status == AT24ET_ALIVE) sum[2] += 1.0; else if(o.status == AT24ET_BORN) sum[3] += 1.0; else if(o.status == AT24ET_DIED) sum[4] += 1.0;
      //--- single change point of the mean over the last three windows (CUSUM): k* = argmax |S_k|, S_k = sum_{j<=k} (x_j - mean)
      if(m >= 90)
        {
         double mu = 0.0;
         for(int j = 0; j < m; j++) mu += ret[hist[j]];
         mu /= m;
         double s2 = 0.0;
         for(int j = 0; j < m; j++) s2 += (ret[hist[j]] - mu) * (ret[hist[j]] - mu);
         double sdv = MathSqrt(s2 / (m - 1));
         double S = 0.0, best = 0.0; int kb = -1;
         for(int j = 0; j < m - 1; j++)
           {
            S += ret[hist[j]] - mu;
            if(MathAbs(S) > best) { best = MathAbs(S); kb = j; }
           }
         if(kb >= 0 && sdv > 0.0)
           {
            double b1 = 0.0, b2 = 0.0;
            for(int j = 0; j <= kb; j++) b1 += ret[hist[j]];
            for(int j = kb + 1; j < m; j++) b2 += ret[hist[j]];
            o.cpIdx = kb; o.cpBar = hist[kb]; o.meanBefore = 1e4 * b1 / (kb + 1); o.meanAfter = 1e4 * b2 / (m - kb - 1); o.cpStat = best / (sdv * MathSqrt((double)m));
           }
        }
      out[h] = o;
     }
   sum[1] = 24.0 * 0.0455;
  }

#endif // AT24_ET_CORE_MQH
