//+------------------------------------------------------------------+
//| AT24_SK_Core.mqh                                                 |
//| Streaks of same-colour candles and what the next candle did.     |
//| "After 3 green days, a red one is due" - is it? Pure maths on    |
//| closed bars, chronological arrays.                               |
//+------------------------------------------------------------------+
#ifndef AT24_SK_CORE_MQH
#define AT24_SK_CORE_MQH

//--- colour of a candle: +1 up, -1 down, 0 flat (a flat candle ends every streak)
int AT24SK_Color(const double o, const double c) { return (c > o) ? 1 : ((c < o) ? -1 : 0); }

//--- streak length (same colour, consecutive) ending at each bar
void AT24SK_Streaks(const int n, const double &o[], const double &c[], int &len[], int &col[])
  {
   ArrayResize(len, n); ArrayResize(col, n);
   for(int i = 0; i < n; i++)
     {
      col[i] = AT24SK_Color(o[i], c[i]);
      if(col[i] == 0) len[i] = 0;
      else if(i > 0 && col[i - 1] == col[i]) len[i] = len[i - 1] + 1;
      else len[i] = 1;
     }
  }

//--- for streak length k = 1..maxK (maxK means "maxK or more"): how often the NEXT candle had the same colour (streak continued).
//--- out[(k-1)*2] count, out[(k-1)*2 + 1] % continued. Baseline (all candles): out[2*maxK] count, out[2*maxK+1] % next candle same colour as the current.
//--- Bars whose next candle is flat are skipped.
void AT24SK_Stats(const int n, const int &len[], const int &col[], const int maxK, double &out[])
  {
   ArrayResize(out, 2 * maxK + 2);
   for(int z = 0; z < 2 * maxK + 2; z++) out[z] = 0.0;
   int cnt[], same[]; ArrayResize(cnt, maxK + 1); ArrayResize(same, maxK + 1);
   for(int k = 0; k <= maxK; k++) { cnt[k] = 0; same[k] = 0; }
   for(int i = 0; i + 1 < n; i++)
     {
      if(col[i] == 0 || col[i + 1] == 0) continue;
      bool cont = (col[i + 1] == col[i]);
      int k = MathMin(len[i], maxK);
      cnt[k]++; if(cont) same[k]++;
      cnt[0]++; if(cont) same[0]++;
     }
   for(int k = 1; k <= maxK; k++) { out[(k - 1) * 2] = cnt[k]; out[(k - 1) * 2 + 1] = cnt[k] > 0 ? 100.0 * same[k] / cnt[k] : 0.0; }
   out[2 * maxK] = cnt[0]; out[2 * maxK + 1] = cnt[0] > 0 ? 100.0 * same[0] / cnt[0] : 0.0;
  }

#endif // AT24_SK_CORE_MQH
