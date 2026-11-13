//+------------------------------------------------------------------+
//| AT24_FM_Core.mqh                                                 |
//| Flow meter maths: per-bar delta from (1) real buy / sell flagged |
//| ticks, (2) the tick rule on a price stream, or (3) a bar-shape   |
//| proxy from OHLC and tick volume; cumulative delta that restarts  |
//| each day. Every mode is labelled by the caller: only (1) is real |
//| order flow. Pure maths, chronological arrays.                    |
//+------------------------------------------------------------------+
#ifndef AT24_FM_CORE_MQH
#define AT24_FM_CORE_MQH

#include "AT24_DV_Core.mqh"

#define AT24FM_FLAG_BUY   1
#define AT24FM_FLAG_SELL  2

//--- (3) bar-shape proxy: tick volume x (close - open) / (high - low); 0 for a flat bar
void AT24FM_BarProxy(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const long &tickVol[], double &delta[])
  {
   for(int i = 0; i < n; i++)
     {
      double rg = high[i] - low[i];
      delta[i] = (rg > 0.0) ? (double)tickVol[i] * (close[i] - open[i]) / rg : 0.0;
     }
  }

//--- (1) and (2) from ticks. Ticks are chronological: timeSec (seconds), price (the price to classify, e.g. last trade or bid/ask mid), vol (0 counts as 1), flags (bit 1 = buy, bit 2 = sell).
//--- real = true: a flagged tick adds +vol (buy) or -vol (sell), unflagged ticks are ignored. real = false: tick rule (price up = buy, down = sell, unchanged carries the last direction; the first tick counts as buy).
//--- bars start at t0 and are `barSec` long; ticks outside [t0, t0 + nb x barSec) are ignored; delta[] is overwritten for bars that have at least one tick and cnt[] gets the tick count (bars without ticks keep cnt 0).
void AT24FM_TickDelta(const int nt, const long &timeSec[], const double &price[], const double &vol[], const int &flags[], const long t0, const int barSec, const int nb, const bool real, double &delta[], int &cnt[])
  {
   for(int b = 0; b < nb; b++) { delta[b] = 0.0; cnt[b] = 0; }
   double prev = 0.0; int dir = 1; bool have = false;
   for(int i = 0; i < nt; i++)
     {
      long off = timeSec[i] - t0;
      if(off < 0) { if(!real) { if(have) { if(price[i] > prev) dir = 1; else if(price[i] < prev) dir = -1; } prev = price[i]; have = true; } continue; }
      int b = (int)(off / barSec);
      double w = vol[i] > 0.0 ? vol[i] : 1.0;
      if(real)
        {
         if((flags[i] & AT24FM_FLAG_BUY) != 0 && b < nb) { delta[b] += w; cnt[b]++; }
         else if((flags[i] & AT24FM_FLAG_SELL) != 0 && b < nb) { delta[b] -= w; cnt[b]++; }
        }
      else
        {
         if(have) { if(price[i] > prev) dir = 1; else if(price[i] < prev) dir = -1; }
         prev = price[i]; have = true;
         if(b < nb) { delta[b] += dir * w; cnt[b]++; }
        }
     }
  }

//--- cumulative delta that restarts when the calendar day (time / 86400) changes
void AT24FM_CumDaily(const int n, const datetime &time[], const double &delta[], double &cum[])
  {
   double run = 0.0; long day = -1;
   for(int i = 0; i < n; i++)
     {
      long d = (long)time[i] / 86400;
      if(d != day) { day = d; run = 0.0; }
      run += delta[i]; cum[i] = run;
     }
  }

#endif // AT24_FM_CORE_MQH
