//+------------------------------------------------------------------+
//| AT24_WG_Core.mqh                                                 |
//| Weekend (market-closed) gaps: size, and how often price came     |
//| back to the previous close, against a mirrored control level.    |
//| Closed bars only. Pure maths, chronological arrays.              |
//+------------------------------------------------------------------+
#ifndef AT24_WG_CORE_MQH
#define AT24_WG_CORE_MQH

struct AT24WG_Gap
  {
   int    bar;        // first bar after the break
   double prevClose;
   double open;
   double size;       // open - prevClose (signed)
   double atr;        // ATR at the last bar before the break
   int    fillBar;    // first bar (from `bar`) whose range reached prevClose (-1 none)
   int    ctrlBar;    // first bar whose range reached the mirrored level (-1 none)
  };

void AT24WG_Atr(const int n, const double &h[], const double &l[], const double &c[], const int len, double &atr[])
  {
   ArrayResize(atr, n);
   for(int i = 0; i < n; i++) atr[i] = 0.0;
   double a = 0.0, sum = 0.0;
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? h[0] - l[0] : MathMax(h[i] - l[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
      if(i < len) { sum += tr; if(i == len - 1) { a = sum / len; atr[i] = a; } }
      else { a = (a * (len - 1) + tr) / len; atr[i] = a; }
     }
  }

//--- a break = more than `breakSec` seconds between consecutive bars (weekend; holidays also count). Gaps smaller than minAtr x ATR are ignored.
int AT24WG_Find(const int n, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[],
                const int breakSec, const double minAtr, AT24WG_Gap &g[])
  {
   double atr[]; AT24WG_Atr(n, high, low, close, 14, atr);
   ArrayResize(g, 0);
   int cnt = 0;
   for(int i = 15; i < n; i++)
     {
      if((long)time[i] - (long)time[i - 1] <= breakSec) continue;
      double size = open[i] - close[i - 1];
      if(atr[i - 1] <= 0.0 || MathAbs(size) < minAtr * atr[i - 1]) continue;
      ArrayResize(g, cnt + 1);
      g[cnt].bar = i; g[cnt].prevClose = close[i - 1]; g[cnt].open = open[i]; g[cnt].size = size; g[cnt].atr = atr[i - 1];
      g[cnt].fillBar = -1; g[cnt].ctrlBar = -1;
      double mirror = open[i] + size;
      for(int j = i; j < n; j++)
        {
         if(g[cnt].fillBar < 0 && ((size > 0.0 && low[j] <= close[i - 1]) || (size < 0.0 && high[j] >= close[i - 1]))) g[cnt].fillBar = j;
         if(g[cnt].ctrlBar < 0 && ((size > 0.0 && high[j] >= mirror) || (size < 0.0 && low[j] <= mirror))) g[cnt].ctrlBar = j;
         if(g[cnt].fillBar >= 0 && g[cnt].ctrlBar >= 0) break;
        }
      cnt++;
     }
   return cnt;
  }

//--- stats over gaps that have at least the longest window of data after them.
//--- out[0] gaps, [1] % up gaps, [2] median |gap| in ATR, then for each window w (bars): out[3+2w] % filled within the window, out[4+2w] control %
void AT24WG_Stats(const int n, const AT24WG_Gap &g[], const int m, const int &win[], const int nw, double &out[])
  {
   ArrayResize(out, 3 + 2 * nw);
   for(int z = 0; z < 3 + 2 * nw; z++) out[z] = 0.0;
   int maxw = 0; for(int k = 0; k < nw; k++) maxw = MathMax(maxw, win[k]);
   double sz[]; ArrayResize(sz, 0);
   int cnt = 0, up = 0;
   int fl[10], ct[10]; for(int k = 0; k < 10; k++) { fl[k] = 0; ct[k] = 0; }
   for(int i = 0; i < m; i++)
     {
      if(g[i].bar + maxw >= n) continue;
      cnt++;
      if(g[i].size > 0.0) up++;
      int a = ArraySize(sz); ArrayResize(sz, a + 1); sz[a] = MathAbs(g[i].size) / g[i].atr;
      for(int k = 0; k < nw; k++)
        {
         if(g[i].fillBar >= 0 && g[i].fillBar - g[i].bar < win[k]) fl[k]++;
         if(g[i].ctrlBar >= 0 && g[i].ctrlBar - g[i].bar < win[k]) ct[k]++;
        }
     }
   out[0] = cnt;
   if(cnt > 0)
     {
      out[1] = 100.0 * up / cnt;
      ArraySort(sz);
      out[2] = (cnt % 2 == 1) ? sz[cnt / 2] : 0.5 * (sz[cnt / 2 - 1] + sz[cnt / 2]);
      for(int k = 0; k < nw; k++) { out[3 + 2 * k] = 100.0 * fl[k] / cnt; out[4 + 2 * k] = 100.0 * ct[k] / cnt; }
     }
  }

#endif // AT24_WG_CORE_MQH
