//+------------------------------------------------------------------+
//| AT24_FVG_Core.mqh                                                |
//| Fair value gaps (three-bar imbalance), whether price came back   |
//| to them and what it did. Non-repainting: a gap exists only once  |
//| the third bar has CLOSED. Pure maths, chronological arrays.      |
//+------------------------------------------------------------------+
#ifndef AT24_FVG_CORE_MQH
#define AT24_FVG_CORE_MQH

struct AT24FV_Gap
  {
   int    bar;      // bar that completed the gap (third bar)
   int    dir;      // +1 bullish (price jumped up), -1 bearish
   double top;
   double bottom;
   int    touch;    // first later bar that traded into the gap (-1 none)
   int    fill;     // first later bar that traded through the whole gap (-1 none)
  };

//--- Wilder ATR (first value = simple mean of the first `len` true ranges)
void AT24FV_Atr(const int n, const double &high[], const double &low[], const double &close[], const int len, double &atr[])
  {
   ArrayResize(atr, n);
   double sum = 0.0;
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? high[0] - low[0] : MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
      if(i < len) { sum += tr; atr[i] = (i == len - 1) ? sum / len : 0.0; }
      else atr[i] = (atr[i - 1] * (len - 1) + tr) / len;
     }
  }

//--- gaps: bullish if low[i] > high[i-2], bearish if high[i] < low[i-2]; height >= minAtr * ATR(i).
int AT24FV_Find(const int n, const double &high[], const double &low[], const double &close[], const int atrLen, const double minAtr, AT24FV_Gap &g[])
  {
   double atr[]; AT24FV_Atr(n, high, low, close, atrLen, atr);
   ArrayResize(g, 0);
   int cnt = 0;
   for(int i = MathMax(2, atrLen); i < n; i++)
     {
      int dir = 0; double top = 0.0, bot = 0.0;
      if(low[i] > high[i - 2]) { dir = 1; top = low[i]; bot = high[i - 2]; }
      else if(high[i] < low[i - 2]) { dir = -1; top = low[i - 2]; bot = high[i]; }
      if(dir == 0 || top - bot < minAtr * atr[i]) continue;
      ArrayResize(g, cnt + 1);
      g[cnt].bar = i; g[cnt].dir = dir; g[cnt].top = top; g[cnt].bottom = bot; g[cnt].touch = -1; g[cnt].fill = -1;
      for(int t = i + 1; t < n; t++)
        {
         bool tch = (dir == 1) ? (low[t] <= top) : (high[t] >= bot);
         bool fil = (dir == 1) ? (low[t] <= bot) : (high[t] >= top);
         if(tch && g[cnt].touch < 0) g[cnt].touch = t;
         if(fil) { g[cnt].fill = t; break; }
        }
      cnt++;
     }
   return cnt;
  }

//--- statistics over gaps that have `win` bars of future data.
//--- out[0] gaps measured, [1] % touched within win, [2] % filled within win, [3] median bars to first touch,
//--- [4] control % (same distance from the close of a bar 100 later, touched within win),
//--- [5] % of touched gaps that reacted (moved one gap-height beyond the zone before a close through it) within `react` bars, [6] touched count
void AT24FV_Stats(const int n, const double &high[], const double &low[], const double &close[], const AT24FV_Gap &g[], const int m,
                  const int win, const int react, double &out[])
  {
   ArrayResize(out, 7);
   for(int z = 0; z < 7; z++) out[z] = 0.0;
   int cnt = 0, tch = 0, fil = 0, rc = 0, ctrlN = 0, ctrlT = 0;
   double wait[]; ArrayResize(wait, 0);
   for(int k = 0; k < m; k++)
     {
      int i = g[k].bar;
      if(i + win >= n) continue;
      cnt++;
      bool touched = (g[k].touch >= 0 && g[k].touch - i <= win);
      if(touched)
        {
         tch++;
         int nw = ArraySize(wait); ArrayResize(wait, nw + 1); wait[nw] = g[k].touch - i;
         double h = g[k].top - g[k].bottom;
         for(int u = g[k].touch; u <= MathMin(n - 1, g[k].touch + react); u++)
           {
            bool failed = (g[k].dir == 1) ? (close[u] < g[k].bottom) : (close[u] > g[k].top);
            if(failed) break;
            bool ok = (g[k].dir == 1) ? (high[u] >= g[k].top + h) : (low[u] <= g[k].bottom - h);
            if(ok) { rc++; break; }
           }
        }
      if(g[k].fill >= 0 && g[k].fill - i <= win) fil++;
      //--- control: same distance from another bar's close, same direction
      int c = i + 100;
      if(c + win < n)
        {
         double d = (g[k].dir == 1) ? close[i] - g[k].top : g[k].bottom - close[i];
         if(d > 0.0)
           {
            ctrlN++;
            double lvl = (g[k].dir == 1) ? close[c] - d : close[c] + d;
            for(int t = c + 1; t <= c + win; t++)
              {
               bool hit = (g[k].dir == 1) ? (low[t] <= lvl) : (high[t] >= lvl);
               if(hit) { ctrlT++; break; }
              }
           }
        }
     }
   out[0] = cnt; out[6] = tch;
   if(cnt > 0) { out[1] = 100.0 * tch / cnt; out[2] = 100.0 * fil / cnt; }
   if(tch > 0)
     {
      ArraySort(wait);
      out[3] = (tch % 2 == 1) ? wait[tch / 2] : 0.5 * (wait[tch / 2 - 1] + wait[tch / 2]);
      out[5] = 100.0 * rc / tch;
     }
   if(ctrlN > 0) out[4] = 100.0 * ctrlT / ctrlN;
  }

#endif // AT24_FVG_CORE_MQH
