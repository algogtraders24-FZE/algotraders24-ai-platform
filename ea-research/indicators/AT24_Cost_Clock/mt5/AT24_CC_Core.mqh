//+------------------------------------------------------------------+
//| AT24_CC_Core.mqh                                                 |
//| Cost clock: per New York hour, the median spread, the median    |
//| hourly range and the median cost/range ratio (spread as a share  |
//| of how far price usually moves in that hour). Pure maths on H1.  |
//+------------------------------------------------------------------+
#ifndef AT24_CC_CORE_MQH
#define AT24_CC_CORE_MQH

struct AT24CC_Hour
  {
   int    hour;
   int    n;
   double medSpread;   // price units
   double medRange;    // price units
   double medRatio;    // spread / range
   int    rank;        // 1 = cheapest hour, 0 = not enough bars
  };

double AT24CC_Median(double &a[], const int m)
  {
   if(m <= 0) return 0.0;
   double b[]; ArrayResize(b, m); for(int i = 0; i < m; i++) b[i] = a[i];
   ArraySort(b);
   return (m % 2 == 1) ? b[m / 2] : 0.5 * (b[m / 2 - 1] + b[m / 2]);
  }

//--- bars with time >= last bar - lookbackDays; only bars with spread > 0 and range > 0; an hour needs at least `minBars` bars
void AT24CC_Analyze(const int n, const datetime &time[], const double &high[], const double &low[], const int &spread[], const int &hr[],
                    const int lookbackDays, const double point, const int minBars, AT24CC_Hour &o[])
  {
   ArrayResize(o, 24);
   datetime from = time[n - 1] - (datetime)((long)lookbackDays * 86400);
   for(int h = 0; h < 24; h++)
     {
      o[h].hour = h; o[h].n = 0; o[h].medSpread = 0.0; o[h].medRange = 0.0; o[h].medRatio = 0.0; o[h].rank = 0;
      double sp[], rg[], ra[]; int m = 0;
      ArrayResize(sp, n); ArrayResize(rg, n); ArrayResize(ra, n);
      for(int i = 0; i < n; i++)
        {
         if(hr[i] != h || time[i] < from || spread[i] <= 0) continue;
         double r = high[i] - low[i];
         if(r <= 0.0) continue;
         sp[m] = spread[i] * point; rg[m] = r; ra[m] = sp[m] / r; m++;
        }
      o[h].n = m;
      if(m >= minBars) { o[h].medSpread = AT24CC_Median(sp, m); o[h].medRange = AT24CC_Median(rg, m); o[h].medRatio = AT24CC_Median(ra, m); }
     }
   for(int h = 0; h < 24; h++)
     {
      if(o[h].n < minBars) continue;
      int rk = 1;
      for(int k = 0; k < 24; k++)
        {
         if(k == h || o[k].n < minBars) continue;
         if(o[k].medRatio < o[h].medRatio || (o[k].medRatio == o[h].medRatio && k < h)) rk++;
        }
      o[h].rank = rk;
     }
  }

#endif // AT24_CC_CORE_MQH
