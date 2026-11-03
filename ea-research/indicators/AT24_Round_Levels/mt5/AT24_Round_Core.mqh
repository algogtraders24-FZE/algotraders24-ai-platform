//+------------------------------------------------------------------+
//| AT24_Round_Core.mqh                                              |
//| Round-number levels and what price did when it touched them,     |
//| compared with CONTROL levels half a step away. Pure maths.       |
//+------------------------------------------------------------------+
#ifndef AT24_ROUND_CORE_MQH
#define AT24_ROUND_CORE_MQH

void AT24RN_Atr(const int n, const double &high[], const double &low[], const double &close[], const int period, double &out[])
  {
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? high[0] - low[0] : MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
      if(i == 0) out[i] = tr;
      else if(i < period) out[i] = (out[i - 1] * i + tr) / (i + 1);
      else out[i] = (out[i - 1] * (period - 1) + tr) / period;
     }
  }

//--- Scan touches of levels (k + offsetFrac) * step. out[0] events, [1] bounced, [2] broke through, [3] neither / ambiguous
//--- A touch = the bar's range contains the level, the previous bar's range did not, and the previous close was at least 0.25 ATR away.
//--- Bounce = within `window` bars price moved `reactAtr` ATR away from the level on the side it came from BEFORE moving that far past it.
void AT24RN_Scan(const int n, const double &high[], const double &low[], const double &close[], const double &atr[],
                 const double step, const double offsetFrac, const int window, const double reactAtr, const int from, int &out[])
  {
   ArrayResize(out, 4);
   out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
   if(step <= 0.0) return;
   for(int i = MathMax(from, 1); i + window <= n - 1; i++)
     {
      if(atr[i] <= 0.0) continue;
      int kmin = (int)MathCeil(low[i] / step - offsetFrac), kmax = (int)MathFloor(high[i] / step - offsetFrac);
      for(int k = kmin; k <= kmax; k++)
        {
         double lv = (k + offsetFrac) * step;
         if(low[i - 1] <= lv && lv <= high[i - 1]) continue;
         if(MathAbs(close[i - 1] - lv) < 0.25 * atr[i]) continue;
         int dir = (close[i - 1] > lv) ? 1 : -1;
         double r = reactAtr * atr[i];
         int res = 0;
         for(int j = i + 1; j <= i + window; j++)
           {
            bool bnc = (dir == 1) ? (high[j] >= lv + r) : (low[j] <= lv - r);
            bool brk = (dir == 1) ? (low[j] <= lv - r) : (high[j] >= lv + r);
            if(bnc && brk) { res = 3; break; }
            if(bnc) { res = 1; break; }
            if(brk) { res = 2; break; }
           }
         out[0]++;
         if(res == 1) out[1]++; else if(res == 2) out[2]++; else out[3]++;
        }
     }
  }

//--- nearest round level below / above a price for a step
double AT24RN_Below(const double price, const double step) { return MathFloor(price / step) * step; }
double AT24RN_Above(const double price, const double step) { return MathCeil(price / step) * step; }

#endif // AT24_ROUND_CORE_MQH
