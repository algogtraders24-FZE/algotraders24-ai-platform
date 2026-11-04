//+------------------------------------------------------------------+
//| AT24_MS_Core.mqh                                                 |
//| Market structure from confirmed swings: BOS (break of structure, |
//| trend continues) and CHoCH (change of character, first break the |
//| other way). Non-repainting: a pivot is only used k bars after it |
//| formed; a break needs a bar CLOSE beyond the level.              |
//| Pure maths, chronological arrays.                                |
//+------------------------------------------------------------------+
#ifndef AT24_MS_CORE_MQH
#define AT24_MS_CORE_MQH

struct AT24MS_Event
  {
   int    bar;       // bar whose close broke the level
   int    lvlBar;    // bar of the broken swing
   double level;
   int    dir;       // +1 broke a swing high, -1 broke a swing low
   int    type;      // 0 = BOS (with the trend), 1 = CHoCH (against it)
  };

//--- scan bars chronologically. trendOut: +1/-1/0 at the end; lastHi/lastLo: latest unbroken pivot (price, bar) or bar -1.
int AT24MS_Scan(const int n, const double &high[], const double &low[], const double &close[], const int k,
                AT24MS_Event &ev[], int &trendOut, double &hiPx, int &hiBar, double &loPx, int &loBar)
  {
   ArrayResize(ev, 0);
   int cnt = 0, trend = 0;
   hiPx = 0.0; hiBar = -1; loPx = 0.0; loBar = -1;
   bool hiOpen = false, loOpen = false;
   for(int i = 0; i < n; i++)
     {
      int j = i - k;
      if(j >= k)
        {
         bool isH = true, isL = true;
         for(int q = j - k; q <= j + k; q++)
           {
            if(q == j) continue;
            if(high[q] >= high[j]) isH = false;
            if(low[q] <= low[j]) isL = false;
           }
         if(isH) { hiPx = high[j]; hiBar = j; hiOpen = true; }
         if(isL) { loPx = low[j]; loBar = j; loOpen = true; }
        }
      if(hiOpen && close[i] > hiPx)
        {
         ArrayResize(ev, cnt + 1);
         ev[cnt].bar = i; ev[cnt].lvlBar = hiBar; ev[cnt].level = hiPx; ev[cnt].dir = 1;
         ev[cnt].type = (trend == -1) ? 1 : 0;
         cnt++; trend = 1; hiOpen = false;
        }
      if(loOpen && close[i] < loPx)
        {
         ArrayResize(ev, cnt + 1);
         ev[cnt].bar = i; ev[cnt].lvlBar = loBar; ev[cnt].level = loPx; ev[cnt].dir = -1;
         ev[cnt].type = (trend == 1) ? 1 : 0;
         cnt++; trend = -1; loOpen = false;
        }
     }
   trendOut = trend;
   if(!hiOpen) hiBar = -1;
   if(!loOpen) loBar = -1;
   return cnt;
  }

//--- what price did `fwd` bars after each break (close vs the break close), and a baseline over all bars.
//--- out[0] BOS count, [1] % of BOS followed in their direction, [2] CHoCH count, [3] same for CHoCH,
//--- [4] baseline % of bars where close[t+fwd] > close[t], [5] BOS with data, [6] CHoCH with data
void AT24MS_Stats(const int n, const double &close[], const AT24MS_Event &ev[], const int m, const int fwd, double &out[])
  {
   ArrayResize(out, 7);
   for(int z = 0; z < 7; z++) out[z] = 0.0;
   int b = 0, c = 0, bOk = 0, cOk = 0, bN = 0, cN = 0;
   for(int e = 0; e < m; e++)
     {
      if(ev[e].type == 0) b++; else c++;
      if(ev[e].bar + fwd >= n) continue;
      bool agree = (ev[e].dir == 1) ? (close[ev[e].bar + fwd] > close[ev[e].bar]) : (close[ev[e].bar + fwd] < close[ev[e].bar]);
      if(ev[e].type == 0) { bN++; if(agree) bOk++; } else { cN++; if(agree) cOk++; }
     }
   int up = 0, tot = 0;
   for(int t = 0; t + fwd < n; t++) { tot++; if(close[t + fwd] > close[t]) up++; }
   out[0] = b; out[2] = c; out[5] = bN; out[6] = cN;
   if(bN > 0) out[1] = 100.0 * bOk / bN;
   if(cN > 0) out[3] = 100.0 * cOk / cN;
   if(tot > 0) out[4] = 100.0 * up / tot;
  }

#endif // AT24_MS_CORE_MQH
