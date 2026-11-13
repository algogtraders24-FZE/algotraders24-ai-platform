//+------------------------------------------------------------------+
//| AT24_EM_Core.mqh                                                 |
//| Event move map: how far did this symbol move in the hour after   |
//| each past economic release, grouped by release name, compared    |
//| with a normal hour of the same bars. Pure maths on bar arrays    |
//| (event times in the same clock as the bar times). Descriptive.   |
//+------------------------------------------------------------------+
#ifndef AT24_EM_CORE_MQH
#define AT24_EM_CORE_MQH

struct AT24EM_Occ
  {
   bool   ok;
   double moveBp;     // close of the last bar of the window versus the open of the first bar, basis points (signed)
   double rangeBp;    // high-low of the whole window, basis points
   double rangeAtr;   // the same range in ATR(14) of the bar before the window
  };

struct AT24EM_Stat
  {
   string name;
   int    n;
   double meanAbsMove;   // basis points
   double meanRange;     // basis points
   double meanRangeX;    // mean window range in ATR divided by the baseline window range in ATR (1.0 = a normal window)
   double maxRange;      // basis points
  };

//--- first bar whose time is at or after the event time floored to the bar length; window = `wb` bars from it
void AT24EM_Measure(const int n, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const double &atr[],
                    const datetime evTime, const int barSec, const int wb, AT24EM_Occ &o)
  {
   o.ok = false; o.moveBp = 0.0; o.rangeBp = 0.0; o.rangeAtr = 0.0;
   long start = ((long)evTime / barSec) * barSec;
   int i0 = -1;
   int lo = 0, hi = n - 1;
   while(lo <= hi) { int mid = (lo + hi) / 2; if((long)time[mid] >= start) { i0 = mid; hi = mid - 1; } else lo = mid + 1; }
   if(i0 < 1 || i0 + wb - 1 > n - 1) return;
   if((long)time[i0] - start > barSec) return;                 // the history has a hole at the event: do not measure the wrong bar
   double hh = high[i0], ll = low[i0];
   for(int k = i0 + 1; k < i0 + wb; k++) { hh = MathMax(hh, high[k]); ll = MathMin(ll, low[k]); }
   double a = atr[i0 - 1];
   if(a <= 0.0 || open[i0] <= 0.0) return;
   o.moveBp = 1e4 * (close[i0 + wb - 1] / open[i0] - 1.0);
   o.rangeBp = 1e4 * (hh - ll) / open[i0];
   o.rangeAtr = (hh - ll) / a;
   o.ok = true;
  }

//--- baseline: mean window range in ATR over every non-overlapping `wb`-bar window of the series
double AT24EM_Baseline(const int n, const double &high[], const double &low[], const double &atr[], const int wb)
  {
   double sum = 0.0; int cnt = 0;
   for(int i = 15; i + wb <= n; i += wb)
     {
      if(atr[i - 1] <= 0.0) continue;
      double hh = high[i], ll = low[i];
      for(int k = i + 1; k < i + wb; k++) { hh = MathMax(hh, high[k]); ll = MathMin(ll, low[k]); }
      sum += (hh - ll) / atr[i - 1]; cnt++;
     }
   return cnt > 0 ? sum / cnt : 0.0;
  }

//--- group measured occurrences by release name (first-seen order)
int AT24EM_Group(const string &names[], const AT24EM_Occ &occ[], const int m, const double baseline, AT24EM_Stat &out[])
  {
   ArrayResize(out, 0);
   int cnt = 0;
   for(int i = 0; i < m; i++)
     {
      if(!occ[i].ok) continue;
      int g = -1;
      for(int k = 0; k < cnt; k++) if(out[k].name == names[i]) { g = k; break; }
      if(g < 0) { ArrayResize(out, cnt + 1); g = cnt++; out[g].name = names[i]; out[g].n = 0; out[g].meanAbsMove = 0.0; out[g].meanRange = 0.0; out[g].meanRangeX = 0.0; out[g].maxRange = 0.0; }
      out[g].n++; out[g].meanAbsMove += MathAbs(occ[i].moveBp); out[g].meanRange += occ[i].rangeBp; out[g].meanRangeX += occ[i].rangeAtr; out[g].maxRange = MathMax(out[g].maxRange, occ[i].rangeBp);
     }
   for(int k = 0; k < cnt; k++)
     {
      out[k].meanAbsMove /= out[k].n; out[k].meanRange /= out[k].n;
      out[k].meanRangeX = (baseline > 0.0) ? (out[k].meanRangeX / out[k].n) / baseline : 0.0;
     }
   return cnt;
  }

#endif // AT24_EM_CORE_MQH
