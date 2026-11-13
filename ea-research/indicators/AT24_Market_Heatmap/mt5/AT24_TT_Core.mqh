//+------------------------------------------------------------------+
//| AT24_TT_Core.mqh                                                 |
//| Edge truth test: is a trade list distinguishable from luck?      |
//| Sign-flip test of the mean, bootstrap range of the total, and    |
//| drawdown against shuffled trade orders. Deterministic xorshift32 |
//| so the numbers are reproducible and checkable in Python.         |
//+------------------------------------------------------------------+
#ifndef AT24_TT_CORE_MQH
#define AT24_TT_CORE_MQH

#define AT24TT_FLIPS   5000
#define AT24TT_BOOT    2000
#define AT24TT_SHUF    2000
#define AT24TT_EPS     1e-9

struct AT24TT_Res
  {
   int    n;
   int    wins;
   double total;
   double mean;
   double sd;
   double t;
   double pf;          // profit factor (0 when no losses)
   double pFlip;       // one-sided: share of sign-flipped lists whose total is >= the actual total
   double bootLo;      // 5th percentile of the bootstrapped total
   double bootHi;      // 95th percentile
   double pLoss;       // share of bootstrap totals <= 0
   double maxDD;       // maximum drawdown of the cumulative result (positive number)
   double ddMedian;    // median max drawdown over shuffled orders
   double ddRank;      // share of shuffled orders with a SMALLER max drawdown than the actual order
  };

uint AT24TT_Next(uint &s)
  {
   s ^= (s << 13);
   s ^= (s >> 17);
   s ^= (s << 5);
   return s;
  }

double AT24TT_MaxDD(const double &p[], const int n)
  {
   double cum = 0.0, peak = 0.0, dd = 0.0;
   for(int i = 0; i < n; i++)
     {
      cum += p[i];
      if(cum > peak) peak = cum;
      if(peak - cum > dd) dd = peak - cum;
     }
   return dd;
  }

void AT24TT_Run(const double &p[], const int n, const uint seed, AT24TT_Res &r)
  {
   r.n = n; r.wins = 0; r.total = 0.0; r.mean = 0.0; r.sd = 0.0; r.t = 0.0; r.pf = 0.0; r.pFlip = 1.0; r.bootLo = 0.0; r.bootHi = 0.0; r.pLoss = 1.0; r.maxDD = 0.0; r.ddMedian = 0.0; r.ddRank = 0.0;
   if(n < 2) return;
   double gw = 0.0, gl = 0.0, s2 = 0.0;
   for(int i = 0; i < n; i++) { r.total += p[i]; s2 += p[i] * p[i]; if(p[i] > 0.0) { r.wins++; gw += p[i]; } else gl -= p[i]; }
   r.mean = r.total / n;
   double var = (s2 - n * r.mean * r.mean) / (n - 1);
   r.sd = MathSqrt(MathMax(var, 0.0));
   r.t = r.sd > 0.0 ? r.mean / (r.sd / MathSqrt((double)n)) : 0.0;
   r.pf = gl > 0.0 ? gw / gl : 0.0;
   uint s = seed;
   //--- sign-flip test (null: profits and losses are symmetric around zero)
   int cnt = 0;
   for(int b = 0; b < AT24TT_FLIPS; b++)
     {
      double sum = 0.0;
      for(int i = 0; i < n; i++) sum += (((AT24TT_Next(s) >> 8) & 1) == 1) ? p[i] : -p[i];
      if(sum >= r.total - AT24TT_EPS) cnt++;
     }
   r.pFlip = (1.0 + cnt) / (AT24TT_FLIPS + 1.0);
   //--- bootstrap range of the total
   double bt[]; ArrayResize(bt, AT24TT_BOOT);
   int le0 = 0;
   for(int b = 0; b < AT24TT_BOOT; b++)
     {
      double sum = 0.0;
      for(int i = 0; i < n; i++) sum += p[(int)(AT24TT_Next(s) % (uint)n)];
      bt[b] = sum;
      if(sum <= AT24TT_EPS) le0++;
     }
   r.pLoss = (double)le0 / AT24TT_BOOT;
   double sb[]; ArrayCopy(sb, bt); ArraySort(sb);
   r.bootLo = sb[(int)(0.05 * AT24TT_BOOT)]; r.bootHi = sb[(int)(0.95 * AT24TT_BOOT)];
   //--- drawdown against shuffled trade orders
   r.maxDD = AT24TT_MaxDD(p, n);
   double q[]; ArrayCopy(q, p);
   double dds[]; ArrayResize(dds, AT24TT_SHUF);
   int smaller = 0;
   for(int b = 0; b < AT24TT_SHUF; b++)
     {
      for(int i = n - 1; i > 0; i--)
        {
         int j = (int)(AT24TT_Next(s) % (uint)(i + 1));
         double tmp = q[i]; q[i] = q[j]; q[j] = tmp;
        }
      dds[b] = AT24TT_MaxDD(q, n);
      if(dds[b] < r.maxDD - AT24TT_EPS) smaller++;
     }
   r.ddRank = (double)smaller / AT24TT_SHUF;
   double sd2[]; ArrayCopy(sd2, dds); ArraySort(sd2);
   r.ddMedian = 0.5 * (sd2[AT24TT_SHUF / 2 - 1] + sd2[AT24TT_SHUF / 2]);
  }

#endif // AT24_TT_CORE_MQH
