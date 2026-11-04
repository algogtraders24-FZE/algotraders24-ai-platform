//+------------------------------------------------------------------+
//| AT24_NW_Core.mqh                                                 |
//| How much bigger was the price range right after high-impact news|
//| than at the same clock time on days without news?                |
//| Event times and bar times must use the same clock (server time). |
//| Closed bars only. Pure maths, chronological arrays.              |
//+------------------------------------------------------------------+
#ifndef AT24_NW_CORE_MQH
#define AT24_NW_CORE_MQH

//--- first bar of the same server day whose time is >= target (-1 if none in that day)
int AT24NW_BarAtOrAfter(const int n, const datetime &time[], const int hint, const datetime target)
  {
   long day = (long)target / 86400;
   int i = hint;
   while(i > 0 && time[i - 1] >= target) i--;           // hint may be ahead
   for(; i < n; i++)
     {
      if((long)time[i] >= (long)target) return ((long)time[i] / 86400 == day) ? i : -1;
     }
   return -1;
  }

double AT24NW_WinRange(const int s, const int win, const double &high[], const double &low[])
  {
   double hi = high[s], lo = low[s];
   for(int i = s + 1; i < s + win; i++) { if(high[i] > hi) hi = high[i]; if(low[i] < lo) lo = low[i]; }
   return hi - lo;
  }

double AT24NW_Median(double &v[], const int m)
  {
   if(m <= 0) return 0.0;
   ArraySort(v);
   return (m % 2 == 1) ? v[m / 2] : 0.5 * (v[m / 2 - 1] + v[m / 2]);
  }

//--- evt[]: sorted event times. win: bars per window. exclusion: seconds around ANY event that disqualify a control window.
//--- ratioOut[k] = range after event k / median range at that clock time on quiet days (-1 if not measurable)
//--- out[0] events measured, [1] median event range, [2] median control range (of the per-event medians),
//--- [3] median ratio, [4] % ratio >= 1.5, [5] % ratio >= 2, [6] % ratio < 1, [7] control windows used
void AT24NW_Study(const int n, const datetime &time[], const double &high[], const double &low[], const datetime &evt[], const int m,
                  const int win, const int exclusion, double &ratioOut[], double &out[])
  {
   ArrayResize(ratioOut, m); ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   if(n < win + 2) return;
   //--- first bar index of each server day
   int dayFirst[]; long dayKey[]; int nd = 0;
   ArrayResize(dayFirst, 0); ArrayResize(dayKey, 0);
   for(int i = 0; i < n; i++)
     {
      long dk = (long)time[i] / 86400;
      if(nd == 0 || dayKey[nd - 1] != dk) { ArrayResize(dayFirst, nd + 1); ArrayResize(dayKey, nd + 1); dayFirst[nd] = i; dayKey[nd] = dk; nd++; }
     }
   double evR[], ctM[], ratios[]; int ne = 0, nr = 0, nc = 0, usedCtrl = 0;
   ArrayResize(evR, 0); ArrayResize(ctM, 0); ArrayResize(ratios, 0);
   for(int k = 0; k < m; k++)
     {
      ratioOut[k] = -1.0;
      long ek = (long)evt[k] / 86400;
      int di = -1;
      for(int j = 0; j < nd; j++) if(dayKey[j] == ek) { di = j; break; }
      if(di < 0) continue;
      int s = AT24NW_BarAtOrAfter(n, time, dayFirst[di], evt[k]);
      if(s < 0 || s + win > n) continue;
      double r = AT24NW_WinRange(s, win, high, low);
      //--- control windows at the same clock time on other days
      long tod = (long)evt[k] % 86400;
      double cr[]; int cn = 0; ArrayResize(cr, 0);
      for(int j = 0; j < nd; j++)
        {
         if(dayKey[j] == ek) continue;
         datetime target = (datetime)(dayKey[j] * 86400 + tod);
         bool quiet = true;
         for(int q = 0; q < m; q++) if(MathAbs((long)evt[q] - (long)target) < exclusion) { quiet = false; break; }
         if(!quiet) continue;
         int s2 = AT24NW_BarAtOrAfter(n, time, dayFirst[j], target);
         if(s2 < 0 || s2 + win > n) continue;
         ArrayResize(cr, cn + 1); cr[cn] = AT24NW_WinRange(s2, win, high, low); cn++;
        }
      if(cn < 5) continue;
      double med = AT24NW_Median(cr, cn);
      if(med <= 0.0) continue;
      ratioOut[k] = r / med;
      usedCtrl += cn;
      ArrayResize(evR, ne + 1); evR[ne] = r; ne++;
      ArrayResize(ctM, nc + 1); ctM[nc] = med; nc++;
      ArrayResize(ratios, nr + 1); ratios[nr] = r / med; nr++;
     }
   out[0] = ne; out[7] = usedCtrl;
   if(ne > 0)
     {
      int a15 = 0, a2 = 0, lt1 = 0;
      for(int i = 0; i < nr; i++) { if(ratios[i] >= 1.5) a15++; if(ratios[i] >= 2.0) a2++; if(ratios[i] < 1.0) lt1++; }
      out[4] = 100.0 * a15 / nr; out[5] = 100.0 * a2 / nr; out[6] = 100.0 * lt1 / nr;
      out[1] = AT24NW_Median(evR, ne); out[2] = AT24NW_Median(ctM, nc); out[3] = AT24NW_Median(ratios, nr);
     }
  }

#endif // AT24_NW_CORE_MQH
