//+------------------------------------------------------------------+
//| AT24_AB_Core.mqh                                                 |
//| Absorption bars: a bar with heavy tick volume (effort) that went |
//| almost nowhere (small range, result), right after a push in one  |
//| direction. Its high-low range becomes a zone; the first return   |
//| into the zone is traded and scored with the Zone Pro machinery   |
//| (touch detection, trade walk, scorecard). Closed bars only.      |
//+------------------------------------------------------------------+
#ifndef AT24_AB_CORE_MQH
#define AT24_AB_CORE_MQH

#include "AT24_ZN_Core.mqh"

//--- volK: tick volume of the bar >= volK x the mean tick volume of the previous volN bars; range <= maxRangeAtr x ATR(14) of the previous bar;
//--- the close of the previous bar moved at least moveAtr x ATR over the `lookback` bars before it: against the zone's expected side. A fall absorbed = demand zone (dir +1), a rise absorbed = supply zone (dir -1).
int AT24AB_Detect(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const long &tickVol[], const double &atr[],
                  const double volK, const int volN, const double maxRangeAtr, const int lookback, const double moveAtr, AT24ZN_Zone &zs[])
  {
   ArrayResize(zs, 0);
   int cnt = 0;
   int start = MathMax(volN, lookback + 1) + 1;
   for(int i = start; i < n; i++)
     {
      double a = atr[i - 1];
      if(a <= 0.0) continue;
      double sum = 0.0;
      for(int k = i - volN; k < i; k++) sum += (double)tickVol[k];
      double avg = sum / volN;
      if(avg <= 0.0 || (double)tickVol[i] < volK * avg) continue;
      if(high[i] - low[i] > maxRangeAtr * a || high[i] - low[i] <= 0.0) continue;
      double move = close[i - 1] - close[i - 1 - lookback];
      int dir = 0;
      if(move <= -moveAtr * a) dir = 1; else if(move >= moveAtr * a) dir = -1;
      if(dir == 0) continue;
      ArrayResize(zs, cnt + 1);
      zs[cnt].idx = i; zs[cnt].dir = dir; zs[cnt].top = high[i]; zs[cnt].bottom = low[i]; zs[cnt].atr = a; zs[cnt].touch = -1;
      cnt++;
     }
   return cnt;
  }

#endif // AT24_AB_CORE_MQH
