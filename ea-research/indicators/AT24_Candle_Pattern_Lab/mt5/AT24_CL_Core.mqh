//+------------------------------------------------------------------+
//| AT24_CL_Core.mqh                                                 |
//| Candlestick patterns on closed bars and what price did after     |
//| them, against the unconditional rate. Pure maths, chronological  |
//| arrays.                                                          |
//+------------------------------------------------------------------+
#ifndef AT24_CL_CORE_MQH
#define AT24_CL_CORE_MQH

#define AT24CL_N 4     // 0 bullish engulfing, 1 bearish engulfing, 2 bullish pin bar, 3 bearish pin bar

//--- ATR (Wilder), value at each bar (0 before len)
void AT24CL_Atr(const int n, const double &h[], const double &l[], const double &c[], const int len, double &atr[])
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

//--- pattern flags per bar (bit k = pattern k). Bars with a range below minAtr * ATR are ignored (noise).
//--- engulfing: opposite colour, body fully covers the previous body and is larger.
//--- pin bar: body <= 30 % of the range and the long wick >= 60 % of the range (bullish = long lower wick).
void AT24CL_Detect(const int n, const double &o[], const double &h[], const double &l[], const double &c[], const double &atr[], const double minAtr, int &flags[])
  {
   ArrayResize(flags, n);
   for(int i = 0; i < n; i++) flags[i] = 0;
   for(int i = 1; i < n; i++)
     {
      double rg = h[i] - l[i];
      if(atr[i] <= 0.0 || rg < minAtr * atr[i] || rg <= 0.0) continue;
      double body = MathAbs(c[i] - o[i]), pbody = MathAbs(c[i - 1] - o[i - 1]);
      bool up = c[i] > o[i], dn = c[i] < o[i], pup = c[i - 1] > o[i - 1], pdn = c[i - 1] < o[i - 1];
      if(up && pdn && o[i] <= c[i - 1] && c[i] >= o[i - 1] && body > pbody) flags[i] |= 1;
      if(dn && pup && o[i] >= c[i - 1] && c[i] <= o[i - 1] && body > pbody) flags[i] |= 2;
      double lower = MathMin(o[i], c[i]) - l[i], upper = h[i] - MathMax(o[i], c[i]);
      if(body <= 0.30 * rg && lower >= 0.60 * rg) flags[i] |= 4;
      if(body <= 0.30 * rg && upper >= 0.60 * rg) flags[i] |= 8;
     }
  }

//--- for each pattern: count with H future bars, % followed by a move in the pattern's direction after H bars,
//--- baseline % (all bars) of up moves (bullish) / down moves (bearish).
//--- out[k*4 + 0] count, +1 % hit, +2 baseline %, +3 mean move after H in the pattern's direction (price units)
void AT24CL_Stats(const int n, const double &c[], const int &flags[], const int H, double &out[])
  {
   ArrayResize(out, AT24CL_N * 4);
   for(int z = 0; z < AT24CL_N * 4; z++) out[z] = 0.0;
   int upAll = 0, totAll = 0;
   for(int i = 0; i + H < n; i++) { totAll++; if(c[i + H] > c[i]) upAll++; }
   double baseUp = totAll > 0 ? 100.0 * upAll / totAll : 0.0;
   for(int k = 0; k < AT24CL_N; k++)
     {
      bool bull = (k % 2 == 0);
      int cnt = 0, hit = 0; double mv = 0.0;
      for(int i = 1; i + H < n; i++)
        {
         if((flags[i] & (1 << k)) == 0) continue;
         double d = c[i + H] - c[i];
         cnt++;
         if(bull ? d > 0.0 : d < 0.0) hit++;
         mv += bull ? d : -d;
        }
      out[k * 4 + 0] = cnt;
      out[k * 4 + 1] = cnt > 0 ? 100.0 * hit / cnt : 0.0;
      out[k * 4 + 2] = bull ? baseUp : 100.0 - baseUp;
      out[k * 4 + 3] = cnt > 0 ? mv / cnt : 0.0;
     }
  }

#endif // AT24_CL_CORE_MQH
