//+------------------------------------------------------------------+
//| AT24_NYOR_Core.mqh                                               |
//| Opening range of a session window and what happened after it.    |
//| The caller passes LOCAL clock times (e.g. New York time), so the |
//| core knows nothing about brokers or daylight saving.             |
//| Closed bars only. Pure maths, chronological arrays.              |
//+------------------------------------------------------------------+
#ifndef AT24_NYOR_CORE_MQH
#define AT24_NYOR_CORE_MQH

struct AT24OR_Day
  {
   long     key;       // local calendar day number
   int      first;     // first bar of the opening range
   int      orEnd;     // last bar of the opening range
   double   hi;
   double   lo;
   int      brk;       // 0 none by the end of the window, +1 up, -1 down
   int      brkBar;
   int      held;      // 1 if the last close of the window is still beyond the broken edge
   int      fake;      // 1 if price closed back inside the range within `fakeBars` bars of the break
   int      ran;       // 1 if price reached one range-height beyond the broken edge
   int      lastBar;   // last bar of the window (-1 if the window has not ended)
   bool     complete;  // the window is over and its data exist
  };

//--- lt[]: local times. start/len/end are minutes of the local day (e.g. 570, 30, 960).
int AT24OR_Analyze(const int n, const datetime &lt[], const double &high[], const double &low[], const double &close[],
                   const int startMin, const int lenMin, const int endMin, const double buffer, const int fakeBars, AT24OR_Day &d[])
  {
   ArrayResize(d, 0);
   int cnt = 0;
   long curKey = -1;
   int k = -1;
   for(int i = 0; i < n; i++)
     {
      long key = (long)lt[i] / 86400;
      int mn = (int)(((long)lt[i] % 86400) / 60);
      if(key != curKey)
        {
         curKey = key;
         ArrayResize(d, cnt + 1);
         k = cnt;
         d[k].key = key; d[k].first = -1; d[k].orEnd = -1; d[k].hi = 0.0; d[k].lo = 0.0; d[k].brk = 0; d[k].brkBar = -1;
         d[k].held = 0; d[k].fake = 0; d[k].ran = 0; d[k].lastBar = -1; d[k].complete = false;
         cnt++;
        }
      if(mn >= startMin && mn < startMin + lenMin)
        {
         if(d[k].first < 0) { d[k].first = i; d[k].hi = high[i]; d[k].lo = low[i]; }
         else { if(high[i] > d[k].hi) d[k].hi = high[i]; if(low[i] < d[k].lo) d[k].lo = low[i]; }
         d[k].orEnd = i;
        }
      else if(mn >= startMin + lenMin && mn <= endMin && d[k].first >= 0)
        {
         d[k].lastBar = i;
         if(d[k].brk == 0)
           {
            if(close[i] > d[k].hi + buffer) { d[k].brk = 1; d[k].brkBar = i; }
            else if(close[i] < d[k].lo - buffer) { d[k].brk = -1; d[k].brkBar = i; }
           }
        }
     }
   //--- classify each day after the break
   for(int j = 0; j < cnt; j++)
     {
      if(d[j].first < 0 || d[j].lastBar < 0) continue;
      d[j].complete = true;
      if(d[j].brk == 0) continue;
      double h = d[j].hi - d[j].lo;
      int b = d[j].brkBar, e = d[j].lastBar;
      d[j].held = (d[j].brk == 1) ? (close[e] > d[j].hi ? 1 : 0) : (close[e] < d[j].lo ? 1 : 0);
      for(int q = b + 1; q <= MathMin(e, b + fakeBars); q++)
        {
         if(close[q] <= d[j].hi && close[q] >= d[j].lo) { d[j].fake = 1; break; }
        }
      for(int q2 = b; q2 <= e; q2++)
        {
         if(d[j].brk == 1 ? (high[q2] >= d[j].hi + h) : (low[q2] <= d[j].lo - h)) { d[j].ran = 1; break; }
        }
     }
   return cnt;
  }

//--- out[0] complete days, [1] % up, [2] % down, [3] % no break, [4] % of broken that held to the window end,
//--- [5] % of broken that closed back inside within fakeBars, [6] % of broken that ran one range-height, [7] median range height, [8] broken days
void AT24OR_Stats(const AT24OR_Day &d[], const int n, double &out[])
  {
   ArrayResize(out, 9);
   for(int z = 0; z < 9; z++) out[z] = 0.0;
   int m = 0, up = 0, dn = 0, none = 0, held = 0, fake = 0, ran = 0;
   double hs[]; ArrayResize(hs, 0);
   for(int i = 0; i < n; i++)
     {
      if(!d[i].complete) continue;
      m++;
      int a = ArraySize(hs); ArrayResize(hs, a + 1); hs[a] = d[i].hi - d[i].lo;
      if(d[i].brk == 1) up++; else if(d[i].brk == -1) dn++; else none++;
      if(d[i].brk != 0) { held += d[i].held; fake += d[i].fake; ran += d[i].ran; }
     }
   int br = up + dn;
   out[0] = m; out[8] = br;
   if(m > 0)
     {
      out[1] = 100.0 * up / m; out[2] = 100.0 * dn / m; out[3] = 100.0 * none / m;
      ArraySort(hs);
      out[7] = (m % 2 == 1) ? hs[m / 2] : 0.5 * (hs[m / 2 - 1] + hs[m / 2]);
     }
   if(br > 0) { out[4] = 100.0 * held / br; out[5] = 100.0 * fake / br; out[6] = 100.0 * ran / br; }
  }

#endif // AT24_NYOR_CORE_MQH
