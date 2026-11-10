//+------------------------------------------------------------------+
//| AT24_HD_Core.mqh                                                 |
//| Audit of a broker's hourly history before any statistic is       |
//| trusted: coverage per year, first fully hourly day, zero-spread  |
//| stretches, flat / invalid bars and missing hours inside trading  |
//| weeks. Pure maths on chronological H1 arrays.                    |
//+------------------------------------------------------------------+
#ifndef AT24_HD_CORE_MQH
#define AT24_HD_CORE_MQH

#define AT24HD_YEARS 24          // years tracked from baseYear

struct AT24HD_Year
  {
   int    year;
   int    bars;
   int    days;          // distinct server days with at least one bar
   int    fullDays;      // days with at least 20 bars (hourly)
   int    zeroSpread;    // bars with spread 0
   int    flat;          // bars with high == low
  };

struct AT24HD_Audit
  {
   int    n;
   int    validFrom;     // index of the first day with at least 20 bars (-1 if none)
   int    invalid;       // bars with high < low, open/close outside [low, high], or non-positive prices
   int    nonMonotonic;  // bars whose time is not after the previous bar
   int    gapCount;      // breaks of 2 to 44 hours between consecutive bars after validFrom (missing hours inside the week or a very short close)
   int    gapHours;      // total missing hours in those breaks
   int    spreadFrom;    // index of the first bar of the first year in which fewer than 5 % of bars have spread 0 (-1 none)
   int    baseYear;
   AT24HD_Year years[AT24HD_YEARS];
  };

//--- year of a server timestamp (civil-from-days, no platform calls)
int AT24HD_YearOf(const long t)
  {
   long z = t / 86400 + 719468;
   long era = (z >= 0 ? z : z - 146096) / 146097;
   long doe = z - era * 146097;
   long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
   long y = yoe + era * 400;
   long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
   long mp = (5 * doy + 2) / 153;
   long m = mp + (mp < 10 ? 3 : -9);
   return (int)(y + (m <= 2 ? 1 : 0));
  }

void AT24HD_Run(const int n, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const int &spread[], AT24HD_Audit &a)
  {
   a.n = n; a.validFrom = -1; a.invalid = 0; a.nonMonotonic = 0; a.gapCount = 0; a.gapHours = 0; a.spreadFrom = -1;
   a.baseYear = AT24HD_YearOf((long)time[0]);
   for(int y = 0; y < AT24HD_YEARS; y++) { a.years[y].year = a.baseYear + y; a.years[y].bars = 0; a.years[y].days = 0; a.years[y].fullDays = 0; a.years[y].zeroSpread = 0; a.years[y].flat = 0; }
   //--- per bar
   for(int i = 0; i < n; i++)
     {
      int yi = AT24HD_YearOf((long)time[i]) - a.baseYear;
      if(yi < 0 || yi >= AT24HD_YEARS) continue;
      a.years[yi].bars++;
      if(spread[i] == 0) a.years[yi].zeroSpread++;
      if(high[i] == low[i]) a.years[yi].flat++;
      if(high[i] < low[i] || open[i] > high[i] || open[i] < low[i] || close[i] > high[i] || close[i] < low[i] || open[i] <= 0.0 || close[i] <= 0.0) a.invalid++;
      if(i > 0 && time[i] <= time[i - 1]) a.nonMonotonic++;
     }
   //--- per day
   int i = 0;
   while(i < n)
     {
      long dk = (long)time[i] / 86400; int j = i;
      while(j < n && (long)time[j] / 86400 == dk) j++;
      int yi = AT24HD_YearOf((long)time[i]) - a.baseYear;
      if(yi >= 0 && yi < AT24HD_YEARS) { a.years[yi].days++; if(j - i >= 20) a.years[yi].fullDays++; }
      if(a.validFrom < 0 && j - i >= 20) a.validFrom = i;
      i = j;
     }
   //--- missing hours inside trading weeks, after the first hourly day
   if(a.validFrom >= 0)
      for(int k = a.validFrom + 1; k < n; k++)
        {
         long gap = (long)(time[k] - time[k - 1]);
         if(gap > 2 * 3600 && gap < 44 * 3600) { a.gapCount++; a.gapHours += (int)(gap / 3600) - 1; }
        }
   //--- first year in which fewer than 5 % of the bars have spread 0 (and at least 500 bars)
   for(int y = 0; y < AT24HD_YEARS; y++)
     {
      if(a.years[y].bars >= 500 && a.years[y].zeroSpread * 20 < a.years[y].bars)
        {
         for(int k = 0; k < n; k++) if(AT24HD_YearOf((long)time[k]) == a.years[y].year) { a.spreadFrom = k; break; }
         break;
        }
     }
  }

#endif // AT24_HD_CORE_MQH
