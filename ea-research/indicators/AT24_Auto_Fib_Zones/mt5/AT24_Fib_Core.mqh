//+------------------------------------------------------------------+
//| AT24_Fib_Core.mqh                                                |
//| Confirmed swing points, swing legs and how deep price retraced   |
//| after each leg. Non-repainting: a swing is only known `k` bars   |
//| after it formed. Pure maths, chronological arrays.               |
//+------------------------------------------------------------------+
#ifndef AT24_FIB_CORE_MQH
#define AT24_FIB_CORE_MQH

struct AT24FB_Swing
  {
   int    idx;        // bar index of the extreme
   int    conf;       // bar index at which the swing became known (idx + k)
   double price;
   int    dir;        // +1 swing high, -1 swing low
  };

//--- alternating swing sequence from k-bar fractals. Two highs (or lows) in a row keep the more extreme one.
int AT24FB_Swings(const int n, const double &high[], const double &low[], const int k, AT24FB_Swing &sw[])
  {
   ArrayResize(sw, 0);
   int cnt = 0;
   for(int i = k; i < n - k; i++)
     {
      bool isH = true, isL = true;
      for(int j = i - k; j <= i + k; j++)
        {
         if(j == i) continue;
         if(high[j] >= high[i]) isH = false;        // strict: the extreme must be unique in its window
         if(low[j] <= low[i]) isL = false;
        }
      if(!isH && !isL) continue;
      for(int pass = 0; pass < 2; pass++)
        {
         int d = (pass == 0) ? 1 : -1;
         if((d == 1 && !isH) || (d == -1 && !isL)) continue;
         double pr = (d == 1) ? high[i] : low[i];
         if(cnt > 0 && sw[cnt - 1].dir == d)
           {
            //--- same side again: keep the more extreme, but the swing is only "known" from the later confirmation
            if((d == 1 && pr > sw[cnt - 1].price) || (d == -1 && pr < sw[cnt - 1].price))
              { sw[cnt - 1].idx = i; sw[cnt - 1].conf = i + k; sw[cnt - 1].price = pr; }
            continue;
           }
         ArrayResize(sw, cnt + 1);
         sw[cnt].idx = i; sw[cnt].conf = i + k; sw[cnt].price = pr; sw[cnt].dir = d;
         cnt++;
        }
     }
   return cnt;
  }

//--- retracement depth after each leg: leg j = swing j -> swing j+1; the next swing j+2 is where the pullback ended.
//--- depth = |swing(j+1) - swing(j+2)| / |swing(j+1) - swing(j)|  (1.0 = the pullback took back the whole leg).
//--- resumed = the swing after that (j+3) went beyond swing j+1 (the leg's extreme).
//--- out[0] legs measured, [1] median depth, [2..6] % of legs whose pullback reached 23.6 / 38.2 / 50 / 61.8 / 78.6 %, [7] % beyond 100 %,
//--- [8] % of legs that resumed, [9] % resumed when the pullback stayed within 61.8 %, [10] legs counted for [9]
void AT24FB_Stats(const AT24FB_Swing &sw[], const int m, double &out[])
  {
   ArrayResize(out, 11);
   for(int z = 0; z < 11; z++) out[z] = 0.0;
   double dep[]; ArrayResize(dep, 0);
   int cnt = 0, r[5], beyond = 0, res = 0, shallow = 0, shallowRes = 0;
   for(int z2 = 0; z2 < 5; z2++) r[z2] = 0;
   double lv[5] = {0.236, 0.382, 0.5, 0.618, 0.786};
   for(int j = 0; j + 3 < m; j++)
     {
      double leg = MathAbs(sw[j + 1].price - sw[j].price);
      if(leg <= 0.0) continue;
      double d = MathAbs(sw[j + 1].price - sw[j + 2].price) / leg;
      int nd = ArraySize(dep); ArrayResize(dep, nd + 1); dep[nd] = d;
      cnt++;
      for(int q = 0; q < 5; q++) if(d >= lv[q]) r[q]++;
      if(d > 1.0) beyond++;
      bool resumed = (sw[j + 1].dir == 1) ? (sw[j + 3].price > sw[j + 1].price) : (sw[j + 3].price < sw[j + 1].price);
      if(resumed) res++;
      if(d <= 0.618) { shallow++; if(resumed) shallowRes++; }
     }
   out[0] = cnt;
   if(cnt > 0)
     {
      ArraySort(dep);
      out[1] = (cnt % 2 == 1) ? dep[cnt / 2] : 0.5 * (dep[cnt / 2 - 1] + dep[cnt / 2]);
      for(int q2 = 0; q2 < 5; q2++) out[2 + q2] = 100.0 * r[q2] / cnt;
      out[7] = 100.0 * beyond / cnt; out[8] = 100.0 * res / cnt;
     }
   out[10] = shallow;
   if(shallow > 0) out[9] = 100.0 * shallowRes / shallow;
  }

#endif // AT24_FIB_CORE_MQH
