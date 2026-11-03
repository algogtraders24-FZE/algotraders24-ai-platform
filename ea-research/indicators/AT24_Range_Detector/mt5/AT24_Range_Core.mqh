//+------------------------------------------------------------------+
//| AT24_Range_Core.mqh                                              |
//| Consolidation ranges found when trend strength (ADX) fades, and  |
//| how those ranges really ended. Pure maths, chronological arrays. |
//| Concept: ADX fading from a trend = a range is forming.           |
//+------------------------------------------------------------------+
#ifndef AT24_RANGE_CORE_MQH
#define AT24_RANGE_CORE_MQH

//--- one range. end: 0 still open, 1 broke up, 2 broke down, 3 ended because strength rose
struct AT24RG_Range
  {
   int    start, last;      // first / last bar of the range
   double hi, lo;
   int    end;
   int    prior;            // direction of the move before the range: +1 / -1 / 0
   int    fake;             // after a breakout: 1 = closed back inside within `fakeBars`, 0 = held, -1 = not resolvable
   double heightAtr;        // (hi - lo) / ATR at the start
  };

//--- Wilder ADX and ATR (period p). adx[i] = 0 until 2p-1 bars exist.
void AT24RG_Adx(const int n, const double &high[], const double &low[], const double &close[], const int period,
                double &adx[], double &atr[])
  {
   double tr[], pm[], mm[], str[], spm[], smm[], dx[];
   ArrayResize(tr, n); ArrayResize(pm, n); ArrayResize(mm, n); ArrayResize(str, n); ArrayResize(spm, n); ArrayResize(smm, n); ArrayResize(dx, n);
   for(int i = 0; i < n; i++)
     {
      adx[i] = 0.0; atr[i] = 0.0; tr[i] = 0.0; pm[i] = 0.0; mm[i] = 0.0; str[i] = 0.0; spm[i] = 0.0; smm[i] = 0.0; dx[i] = 0.0;
      if(i == 0) continue;
      double up = high[i] - high[i - 1], dn = low[i - 1] - low[i];
      pm[i] = (up > dn && up > 0.0) ? up : 0.0;
      mm[i] = (dn > up && dn > 0.0) ? dn : 0.0;
      tr[i] = MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
     }
   double st = 0.0, sp = 0.0, sm = 0.0, run = 0.0;
   for(int i = 1; i < n; i++)
     {
      run += tr[i];
      if(i < period) { atr[i] = run / i; continue; }
      if(i == period) { for(int k = 1; k <= period; k++) { st += tr[k]; sp += pm[k]; sm += mm[k]; } }
      else { st = st - st / period + tr[i]; sp = sp - sp / period + pm[i]; sm = sm - sm / period + mm[i]; }
      atr[i] = st / period;
      double pdi = (st > 0.0) ? 100.0 * sp / st : 0.0, mdi = (st > 0.0) ? 100.0 * sm / st : 0.0;
      dx[i] = (pdi + mdi > 0.0) ? 100.0 * MathAbs(pdi - mdi) / (pdi + mdi) : 0.0;
      if(i == 2 * period - 1) { double sdx = 0.0; for(int k2 = period; k2 <= 2 * period - 1; k2++) sdx += dx[k2]; adx[i] = sdx / period; }
      else if(i >= 2 * period) adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
     }
  }

//--- find ranges. A range opens when ADX has been lower than `slope` bars earlier for `declineBars` readings in a row AND ADX was at least
//--- `minPeak` somewhere in the last `peakLook` bars. It closes on a breakout close (beyond the box by breakPct % of that bar's range) or,
//--- if endOnRise, when ADX rises. Boxes shorter than minBars are dropped.
int AT24RG_Find(const int n, const double &high[], const double &low[], const double &close[], const double &adx[], const double &atr[],
                const int slope, const int declineBars, const double minPeak, const int peakLook, const double breakPct, const bool endOnRise,
                const int minBars, const int fakeBars, AT24RG_Range &rg[])
  {
   ArrayResize(rg, 0);
   int cnt = 0, dec = 0;
   bool open = false;
   int st = 0; double hi = 0, lo = 0;
   int first = 100;   // ADX needs 2 x period bars (period <= 40)
   for(int i = first; i < n; i++)
     {
      bool fade = (adx[i] > 0.0 && adx[i] < adx[i - slope]);
      if(!open)
        {
         dec = fade ? dec + 1 : 0;
         if(dec >= declineBars)
           {
            double pk = 0.0;
            for(int k = MathMax(0, i - peakLook); k <= i; k++) pk = MathMax(pk, adx[k]);
            if(pk >= minPeak)
              {
               open = true; st = i - dec + 1; hi = high[st]; lo = low[st];
               for(int k2 = st; k2 <= i; k2++) { hi = MathMax(hi, high[k2]); lo = MathMin(lo, low[k2]); }
              }
           }
         continue;
        }
      //--- open: check the end BEFORE letting the box grow with this bar
      double r = high[i] - low[i];
      int endType = 0;
      if(r > 0.0)
        {
         if(close[i] > hi && (close[i] - hi) / r >= breakPct / 100.0) endType = 1;
         else if(close[i] < lo && (lo - close[i]) / r >= breakPct / 100.0) endType = 2;
        }
      if(endType == 0 && endOnRise && adx[i] > adx[i - slope]) endType = 3;
      if(endType != 0)
        {
         if(i - 1 - st + 1 >= minBars)
           {
            ArrayResize(rg, cnt + 1);
            rg[cnt].start = st; rg[cnt].last = i - 1; rg[cnt].hi = hi; rg[cnt].lo = lo; rg[cnt].end = endType;
            int b0 = MathMax(0, st - 20);
            rg[cnt].prior = (close[st] > close[b0]) ? 1 : (close[st] < close[b0] ? -1 : 0);
            rg[cnt].heightAtr = (atr[st] > 0.0) ? (hi - lo) / atr[st] : 0.0;
            rg[cnt].fake = -1;
            if(endType == 1 || endType == 2)
              {
               if(i + fakeBars <= n - 1)
                 {
                  rg[cnt].fake = 0;
                  for(int f = i + 1; f <= i + fakeBars; f++)
                     if(close[f] <= hi && close[f] >= lo) { rg[cnt].fake = 1; break; }
                 }
              }
            cnt++;
           }
         open = false; dec = 0;
         continue;
        }
      hi = MathMax(hi, high[i]); lo = MathMin(lo, low[i]);
     }
   //--- a range still open at the end
   if(open && n - 1 - st + 1 >= minBars)
     {
      ArrayResize(rg, cnt + 1);
      rg[cnt].start = st; rg[cnt].last = n - 1; rg[cnt].hi = hi; rg[cnt].lo = lo; rg[cnt].end = 0;
      int b1 = MathMax(0, st - 20);
      rg[cnt].prior = (close[st] > close[b1]) ? 1 : (close[st] < close[b1] ? -1 : 0);
      rg[cnt].heightAtr = (atr[st] > 0.0) ? (hi - lo) / atr[st] : 0.0;
      rg[cnt].fake = -1;
      cnt++;
     }
   return cnt;
  }

double AT24RG_Median(double &v[], const int cnt)
  {
   if(cnt <= 0) return 0.0;
   ArraySort(v);
   return (cnt % 2 == 1) ? v[cnt / 2] : 0.5 * (v[cnt / 2 - 1] + v[cnt / 2]);
  }

//--- out[0] finished ranges, [1] median length (bars), [2] median height (ATR), [3] % broke up, [4] % broke down, [5] % ended by strength rising,
//--- [6] % of breakouts that went the way of the prior move, [7] % of resolvable breakouts that fell back inside (false), [8] breakouts counted, [9] resolvable breakouts
void AT24RG_Stats(const AT24RG_Range &rg[], const int cnt, double &out[])
  {
   ArrayResize(out, 10);
   for(int z = 0; z < 10; z++) out[z] = 0.0;
   double lens[], hts[]; ArrayResize(lens, 0); ArrayResize(hts, 0);
   int fin = 0, up = 0, dn = 0, rise = 0, cont = 0, brk = 0, fk = 0, res = 0;
   for(int i = 0; i < cnt; i++)
     {
      if(rg[i].end == 0) continue;
      fin++;
      int nl = ArraySize(lens); ArrayResize(lens, nl + 1); lens[nl] = rg[i].last - rg[i].start + 1;
      int nh = ArraySize(hts); ArrayResize(hts, nh + 1); hts[nh] = rg[i].heightAtr;
      if(rg[i].end == 1) up++; else if(rg[i].end == 2) dn++; else rise++;
      if(rg[i].end == 1 || rg[i].end == 2)
        {
         brk++;
         int d = (rg[i].end == 1) ? 1 : -1;
         if(rg[i].prior != 0 && d == rg[i].prior) cont++;
         if(rg[i].fake >= 0) { res++; if(rg[i].fake == 1) fk++; }
        }
     }
   out[0] = fin; out[8] = brk; out[9] = res;
   if(fin > 0) { out[1] = AT24RG_Median(lens, fin); out[2] = AT24RG_Median(hts, fin); out[3] = 100.0 * up / fin; out[4] = 100.0 * dn / fin; out[5] = 100.0 * rise / fin; }
   int withPrior = 0;
   for(int j = 0; j < cnt; j++) if((rg[j].end == 1 || rg[j].end == 2) && rg[j].prior != 0) withPrior++;
   if(withPrior > 0) out[6] = 100.0 * cont / withPrior;
   if(res > 0) out[7] = 100.0 * fk / res;
  }

#endif // AT24_RANGE_CORE_MQH
