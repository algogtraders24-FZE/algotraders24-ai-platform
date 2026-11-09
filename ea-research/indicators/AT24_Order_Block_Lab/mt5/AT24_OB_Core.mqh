//+------------------------------------------------------------------+
//| AT24_OB_Core.mqh                                                 |
//| "Order blocks": the last opposite-colour candle before a strong  |
//| move. Detected on closed bars, then tested: did price come back  |
//| to the block and react, against a mirrored control zone?         |
//| Pure maths, chronological arrays.                                |
//+------------------------------------------------------------------+
#ifndef AT24_OB_CORE_MQH
#define AT24_OB_CORE_MQH

struct AT24OB_Block
  {
   int    bar;       // the order-block candle
   int    conf;      // bar whose close confirmed the move (known only then)
   int    dir;       // +1 bullish (down candle before an up move), -1 bearish
   double top;
   double bottom;
   double refClose;  // close of the confirmation bar
   double atr;       // ATR at the confirmation bar
   int    touch;     // first bar after confirmation that reached the block (-1 none)
   int    ctrl;      // first bar that reached the mirrored control zone (-1 none)
   int    res;       // reaction after the touch: +1 reacted, -1 broke, 0 undecided
   int    cres;      // same for the control zone
  };

void AT24OB_Atr(const int n, const double &h[], const double &l[], const double &c[], const int len, double &atr[])
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

//--- reaction after a first touch: within `look` bars the close moves frac*ATR away from the level (reacted) before closing frac*ATR beyond it (broke)
int AT24OB_React(const int n, const double &close[], const int tb, const double L, const double s, const double thr, const int look)
  {
   for(int u = tb; u <= MathMin(n - 1, tb + look); u++)
     {
      double away = (close[u] - L) * s, beyond = (close[u] - L) * (-s);
      if(away >= thr) return 1;
      if(beyond >= thr) return -1;
     }
   return 0;
  }

//--- block j: a down candle (bullish block) / up candle (bearish block) whose high (low) is broken by a CLOSE of at least `k` ATR beyond it
//--- within the next 3 bars. One block per move (a new block cannot start within 3 bars of the previous one).
//--- touch: within `touchWin` bars after confirmation; reaction threshold = frac * ATR, judged over `look` bars.
int AT24OB_Find(const int n, const double &open[], const double &high[], const double &low[], const double &close[],
                const double k, const int touchWin, const int look, const double frac, AT24OB_Block &b[])
  {
   double atr[]; AT24OB_Atr(n, high, low, close, 14, atr);
   ArrayResize(b, 0);
   int cnt = 0, lastJ = -10;
   for(int j = 15; j + 3 < n; j++)
     {
      if(j - lastJ < 3) continue;
      int dir = 0;
      if(close[j] < open[j]) dir = 1; else if(close[j] > open[j]) dir = -1; else continue;
      int conf = -1;
      for(int t = j + 1; t <= j + 3; t++)
        {
         if(atr[t] <= 0.0) break;
         if(dir == 1 && close[t] - high[j] >= k * atr[t]) { conf = t; break; }
         if(dir == -1 && low[j] - close[t] >= k * atr[t]) { conf = t; break; }
        }
      if(conf < 0) continue;
      lastJ = j;
      ArrayResize(b, cnt + 1);
      b[cnt].bar = j; b[cnt].conf = conf; b[cnt].dir = dir; b[cnt].top = high[j]; b[cnt].bottom = low[j];
      b[cnt].refClose = close[conf]; b[cnt].atr = atr[conf]; b[cnt].touch = -1; b[cnt].ctrl = -1; b[cnt].res = 0; b[cnt].cres = 0;
      double thr = frac * atr[conf];
      //--- real block: price returns from above (bullish: level = top, away = up) / from below (bearish: level = bottom, away = down)
      double L = (dir == 1) ? high[j] : low[j], s = (dir == 1) ? 1.0 : -1.0;
      for(int u = conf + 1; u <= MathMin(n - 1, conf + touchWin); u++)
        {
         if((dir == 1 && low[u] <= L) || (dir == -1 && high[u] >= L)) { b[cnt].touch = u; break; }
        }
      if(b[cnt].touch >= 0) b[cnt].res = AT24OB_React(n, close, b[cnt].touch, L, s, thr, look);
      //--- control: the block mirrored through the confirmation close; price approaches it from the other side
      double mir = 2.0 * close[conf] - L, sc = -s;
      for(int u = conf + 1; u <= MathMin(n - 1, conf + touchWin); u++)
        {
         if((dir == 1 && high[u] >= mir) || (dir == -1 && low[u] <= mir)) { b[cnt].ctrl = u; break; }
        }
      if(b[cnt].ctrl >= 0) b[cnt].cres = AT24OB_React(n, close, b[cnt].ctrl, mir, sc, thr, look);
      cnt++;
     }
   return cnt;
  }

//--- blocks with a full follow-up (conf + touchWin + look < n): out[0] blocks, [1] % touched, [2] control % touched,
//--- [3] % reacted of decided touches, [4] control %, [5] decided touches, [6] control decided
void AT24OB_Stats(const int n, const AT24OB_Block &b[], const int m, const int touchWin, const int look, double &out[])
  {
   ArrayResize(out, 7);
   for(int z = 0; z < 7; z++) out[z] = 0.0;
   int cnt = 0, tch = 0, ct = 0, dec = 0, rea = 0, cdec = 0, crea = 0;
   for(int i = 0; i < m; i++)
     {
      if(b[i].conf + touchWin + look >= n) continue;
      cnt++;
      if(b[i].touch >= 0) tch++;
      if(b[i].ctrl >= 0) ct++;
      if(b[i].res != 0) { dec++; if(b[i].res == 1) rea++; }
      if(b[i].cres != 0) { cdec++; if(b[i].cres == 1) crea++; }
     }
   out[0] = cnt;
   if(cnt > 0) { out[1] = 100.0 * tch / cnt; out[2] = 100.0 * ct / cnt; }
   out[3] = dec > 0 ? 100.0 * rea / dec : 0.0; out[4] = cdec > 0 ? 100.0 * crea / cdec : 0.0; out[5] = dec; out[6] = cdec;
  }

#endif // AT24_OB_CORE_MQH
