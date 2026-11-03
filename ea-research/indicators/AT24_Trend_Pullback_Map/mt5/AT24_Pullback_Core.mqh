//+------------------------------------------------------------------+
//| AT24_Pullback_Core.mqh                                           |
//| EMA ribbon trend state + EMA pullback events and their outcomes. |
//| Pure maths: no chart calls. Arrays are chronological.            |
//+------------------------------------------------------------------+
#ifndef AT24_PULLBACK_CORE_MQH
#define AT24_PULLBACK_CORE_MQH

//--- one pullback touch: price came back to the fast EMA inside a trend
//--- outcome: 1 resumed (new swing extreme before the mid EMA failed), 2 failed (close beyond the mid EMA first),
//--- 0 neither within the window, -1 not resolvable yet (too recent)
struct AT24TP_Ev
  {
   int    idx;       // bar index of the touch
   int    dir;       // +1 uptrend pullback, -1 downtrend pullback
   int    outcome;
   int    bars;      // bars until resolution (or window length)
   double depth;     // deepest excursion against the trend, in ATR
  };

void AT24TP_Ema(const int n, const double &src[], const int period, double &out[])
  {
   double a = 2.0 / (period + 1.0);
   for(int i = 0; i < n; i++) out[i] = (i == 0) ? src[0] : a * src[i] + (1.0 - a) * out[i - 1];
  }

void AT24TP_Atr(const int n, const double &high[], const double &low[], const double &close[], const int period, double &out[])
  {
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? high[0] - low[0] : MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
      if(i == 0) out[i] = tr;
      else if(i < period) out[i] = (out[i - 1] * i + tr) / (i + 1);
      else out[i] = (out[i - 1] * (period - 1) + tr) / period;
     }
  }

//--- trend: +1 up (fast > mid > slow and mid rising), -1 down, 0 range / not enough data
void AT24TP_Trend(const int n, const double &ef[], const double &em[], const double &es[], const double &atr[],
                  const int slow, const int slopeBars, const double slopeMinAtr, int &trend[])
  {
   for(int i = 0; i < n; i++)
     {
      trend[i] = 0;
      if(i < slow + slopeBars) continue;
      double slope = em[i] - em[i - slopeBars];
      if(ef[i] > em[i] && em[i] > es[i] && slope > slopeMinAtr * atr[i]) trend[i] = 1;
      else if(ef[i] < em[i] && em[i] < es[i] && -slope > slopeMinAtr * atr[i]) trend[i] = -1;
     }
  }

//--- pullback events. swingBars: bars before the touch used for the swing extreme; window: bars allowed to resolve
int AT24TP_Events(const int n, const double &high[], const double &low[], const double &close[], const double &ef[], const double &em[],
                  const double &atr[], const int &trend[], const int swingBars, const int window, AT24TP_Ev &ev[])
  {
   ArrayResize(ev, 0);
   int cnt = 0;
   for(int i = swingBars + 1; i < n; i++)
     {
      int d = trend[i];
      if(d == 0) continue;
      bool touch = (d == 1) ? (low[i] <= ef[i] && (low[i - 1] > ef[i - 1] || trend[i - 1] != 1))
                            : (high[i] >= ef[i] && (high[i - 1] < ef[i - 1] || trend[i - 1] != -1));
      if(!touch) continue;
      double ref = (d == 1) ? high[i - 1] : low[i - 1];
      for(int k = i - swingBars; k < i; k++) ref = (d == 1) ? MathMax(ref, high[k]) : MathMin(ref, low[k]);
      int out = -1, bars = 0;
      double worst = (d == 1) ? low[i] : high[i];
      int last = MathMin(n - 1, i + window);
      for(int j = i + 1; j <= last; j++)
        {
         worst = (d == 1) ? MathMin(worst, low[j]) : MathMax(worst, high[j]);
         if(d == 1 && close[j] < em[j]) { out = 2; bars = j - i; break; }
         if(d == -1 && close[j] > em[j]) { out = 2; bars = j - i; break; }
         if(d == 1 && high[j] > ref) { out = 1; bars = j - i; break; }
         if(d == -1 && low[j] < ref) { out = 1; bars = j - i; break; }
        }
      if(out == -1 && i + window <= n - 1) { out = 0; bars = window; }
      ArrayResize(ev, cnt + 1);
      ev[cnt].idx = i; ev[cnt].dir = d; ev[cnt].outcome = out; ev[cnt].bars = bars;
      ev[cnt].depth = (atr[i] > 0.0) ? MathAbs(ref - worst) / atr[i] : 0.0;
      cnt++;
     }
   return cnt;
  }

//--- out[0] resolved events, [1] % resumed, [2] % failed, [3] % neither, [4] median depth (ATR), [5] median bars to resolve (resolved only), [6] up events, [7] down events
void AT24TP_Stats(const AT24TP_Ev &ev[], const int cnt, double &out[])
  {
   ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   int r = 0, res = 0, fail = 0, neu = 0, up = 0, dn = 0;
   double depths[], bs[]; ArrayResize(depths, 0); ArrayResize(bs, 0);
   for(int i = 0; i < cnt; i++)
     {
      if(ev[i].dir == 1) up++; else dn++;
      if(ev[i].outcome == -1) continue;
      r++;
      int nd = ArraySize(depths); ArrayResize(depths, nd + 1); depths[nd] = ev[i].depth;
      if(ev[i].outcome == 1) { res++; int nb = ArraySize(bs); ArrayResize(bs, nb + 1); bs[nb] = ev[i].bars; }
      else if(ev[i].outcome == 2) fail++;
      else neu++;
     }
   out[0] = r; out[6] = up; out[7] = dn;
   if(r > 0) { out[1] = 100.0 * res / r; out[2] = 100.0 * fail / r; out[3] = 100.0 * neu / r; }
   int nd2 = ArraySize(depths);
   if(nd2 > 0) { ArraySort(depths); out[4] = (nd2 % 2 == 1) ? depths[nd2 / 2] : 0.5 * (depths[nd2 / 2 - 1] + depths[nd2 / 2]); }
   int nb2 = ArraySize(bs);
   if(nb2 > 0) { ArraySort(bs); out[5] = (nb2 % 2 == 1) ? bs[nb2 / 2] : 0.5 * (bs[nb2 / 2 - 1] + bs[nb2 / 2]); }
  }

#endif // AT24_PULLBACK_CORE_MQH
