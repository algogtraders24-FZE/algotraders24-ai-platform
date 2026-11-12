//+------------------------------------------------------------------+
//| AT24_Squeeze_Core.mqh                                            |
//| Bollinger-inside-Keltner squeeze state, momentum, and what price |
//| really did after squeezes released. Pure maths, chronological.   |
//+------------------------------------------------------------------+
#ifndef AT24_SQUEEZE_CORE_MQH
#define AT24_SQUEEZE_CORE_MQH

//--- one squeeze release: first bar after a squeeze of at least `minBars` bars
struct AT24SQ_Ev
  {
   int    idx;        // release bar
   int    len;        // length of the squeeze that just ended (bars)
   int    mom;        // +1 / -1 momentum sign at release (close vs middle band)
   double up, dn;     // best excursion up / down in the next `window` bars, in ATR (-1 = not resolvable yet)
   double range;      // up + dn : total range of the next `window` bars in ATR
  };

void AT24SQ_Atr(const int n, const double &high[], const double &low[], const double &close[], const int period, double &out[])
  {
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? high[0] - low[0] : MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
      if(i == 0) out[i] = tr;
      else if(i < period) out[i] = (out[i - 1] * i + tr) / (i + 1);
      else out[i] = (out[i - 1] * (period - 1) + tr) / period;
     }
  }

//--- squeeze[i] = 1 when the Bollinger bands sit inside the Keltner channel; mid[] = SMA(bbLen); mom[] = close minus the mean of (donchian mid, SMA)
void AT24SQ_Calc(const int n, const double &high[], const double &low[], const double &close[], const int bbLen, const double bbMult,
                 const int kcLen, const double kcMult, const int atrLen, double &mid[], double &mom[], double &atr[], double &ratio[], int &squeeze[])
  {
   AT24SQ_Atr(n, high, low, close, atrLen, atr);
   for(int i = 0; i < n; i++)
     {
      squeeze[i] = 0; mid[i] = 0.0; mom[i] = 0.0; ratio[i] = 0.0;
      if(i + 1 < MathMax(bbLen, kcLen)) continue;
      double s = 0.0, hh = high[i], ll = low[i];
      for(int k = i - bbLen + 1; k <= i; k++) { s += close[k]; hh = MathMax(hh, high[k]); ll = MathMin(ll, low[k]); }
      double ma = s / bbLen, v = 0.0;
      for(int k2 = i - bbLen + 1; k2 <= i; k2++) v += (close[k2] - ma) * (close[k2] - ma);
      double sd = MathSqrt(v / bbLen);
      double s2 = 0.0;
      for(int k3 = i - kcLen + 1; k3 <= i; k3++) s2 += close[k3];
      double kma = s2 / kcLen;
      double bbw = 2.0 * bbMult * sd, kcw = 2.0 * kcMult * atr[i];
      ratio[i] = (kcw > 0.0) ? bbw / kcw : 0.0;
      mid[i] = ma;
      squeeze[i] = ((ma + bbMult * sd) < (kma + kcMult * atr[i]) && (ma - bbMult * sd) > (kma - kcMult * atr[i])) ? 1 : 0;
      mom[i] = close[i] - ((hh + ll) / 2.0 + ma) / 2.0;
     }
  }

//--- releases after squeezes of at least minBars bars
int AT24SQ_Events(const int n, const double &high[], const double &low[], const double &close[], const double &mid[], const double &atr[],
                  const int &squeeze[], const int minBars, const int window, AT24SQ_Ev &ev[])
  {
   ArrayResize(ev, 0);
   int cnt = 0, run = 0;
   for(int i = 1; i < n; i++)
     {
      if(squeeze[i] == 1) { run++; continue; }
      if(run >= minBars && squeeze[i - 1] == 1 && atr[i] > 0.0)
        {
         ArrayResize(ev, cnt + 1);
         ev[cnt].idx = i; ev[cnt].len = run;
         ev[cnt].mom = (close[i] >= mid[i]) ? 1 : -1;
         if(i + window <= n - 1)
           {
            double mx = high[i + 1], mn = low[i + 1];
            for(int j = i + 2; j <= i + window; j++) { mx = MathMax(mx, high[j]); mn = MathMin(mn, low[j]); }
            ev[cnt].up = (mx - close[i]) / atr[i]; ev[cnt].dn = (close[i] - mn) / atr[i]; ev[cnt].range = (mx - mn) / atr[i];
           }
         else { ev[cnt].up = -1.0; ev[cnt].dn = -1.0; ev[cnt].range = -1.0; }
         cnt++;
        }
      run = 0;
     }
   return cnt;
  }

double AT24SQ_Median(double &v[], const int cnt)
  {
   if(cnt <= 0) return 0.0;
   ArraySort(v);
   return (cnt % 2 == 1) ? v[cnt / 2] : 0.5 * (v[cnt / 2 - 1] + v[cnt / 2]);
  }

//--- baseline: median range of ANY `window` bars (in ATR), the yardstick for post-squeeze ranges
double AT24SQ_Baseline(const int n, const double &high[], const double &low[], const double &atr[], const int window, const int from)
  {
   double v[]; ArrayResize(v, 0);
   int cnt = 0;
   for(int i = MathMax(from, 1); i + window <= n - 1; i += 3)
     {
      if(atr[i] <= 0.0) continue;
      double mx = high[i + 1], mn = low[i + 1];
      for(int j = i + 2; j <= i + window; j++) { mx = MathMax(mx, high[j]); mn = MathMin(mn, low[j]); }
      ArrayResize(v, cnt + 1); v[cnt] = (mx - mn) / atr[i]; cnt++;
     }
   return AT24SQ_Median(v, cnt);
  }

//--- out[0] resolved releases, [1] median post-release range (ATR), [2] baseline median range (ATR), [3] % of releases above the baseline,
//--- [4] median best-side move (ATR), [5] % where the momentum sign matched the bigger side, [6] median squeeze length, [7] all releases found
void AT24SQ_Stats(const AT24SQ_Ev &ev[], const int cnt, const double baseline, double &out[])
  {
   ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   double ranges[], best[], lens[]; ArrayResize(ranges, 0); ArrayResize(best, 0); ArrayResize(lens, 0);
   int r = 0, above = 0, hit = 0;
   for(int i = 0; i < cnt; i++)
     {
      int nl = ArraySize(lens); ArrayResize(lens, nl + 1); lens[nl] = ev[i].len;
      if(ev[i].range < 0.0) continue;
      int nr = ArraySize(ranges); ArrayResize(ranges, nr + 1); ranges[nr] = ev[i].range;
      int nb = ArraySize(best); ArrayResize(best, nb + 1); best[nb] = MathMax(ev[i].up, ev[i].dn);
      r++;
      if(ev[i].range > baseline) above++;
      int win = (ev[i].up >= ev[i].dn) ? 1 : -1;
      if(win == ev[i].mom) hit++;
     }
   out[0] = r; out[2] = baseline; out[7] = cnt;
   if(r > 0) { out[3] = 100.0 * above / r; out[5] = 100.0 * hit / r; out[1] = AT24SQ_Median(ranges, r); out[4] = AT24SQ_Median(best, r); }
   if(cnt > 0) out[6] = AT24SQ_Median(lens, cnt);
  }

#endif // AT24_SQUEEZE_CORE_MQH
