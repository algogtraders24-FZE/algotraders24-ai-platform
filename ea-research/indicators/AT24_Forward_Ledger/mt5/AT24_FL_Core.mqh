//+------------------------------------------------------------------+
//| AT24_FL_Core.mqh                                                 |
//| Forward ledger: candidate rules are registered with a date and   |
//| only trades that START after that date count. Out-of-sample      |
//| statistics, no hindsight. Pure maths on closed H1 bars.          |
//+------------------------------------------------------------------+
#ifndef AT24_FL_CORE_MQH
#define AT24_FL_CORE_MQH

struct AT24FL_Stat
  {
   int    n;
   double meanBp;      // mean trade return in basis points
   double sdBp;
   double t;           // t-statistic of the raw mean
   double hitPct;      // % of trades with a positive return
   double cumBp;       // sum of trade returns
   double meanDir;     // mean trade direction (+1 long, -1 short)
   double driftBp;     // mean return of ALL bars since registration, per bar (the market's own drift)
   double hold;        // bars held per trade
   double adjMeanBp;   // mean minus the drift a trader with this direction mix would have collected anyway
   double tAdj;        // t-statistic of the drift-adjusted mean
  };

//--- first index of the first server day that has at least `minBars` bars (history before it is too sparse to trust)
int AT24FL_ValidFrom(const int n, const datetime &time[], const int minBars)
  {
   int i = 0;
   while(i < n)
     {
      long dk = (long)time[i] / 86400;
      int j = i;
      while(j < n && (long)time[j] / 86400 == dk) j++;
      if(j - i >= minBars) return i;
      i = j;
     }
   return n;
  }

void AT24FL_Atr(const int n, const double &h[], const double &l[], const double &c[], const int len, double &atr[])
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

//--- rules: 0 = long the New York hour `param` (default 18), one bar.
//---        1 = after an H1 bar whose body is >= 2.5 ATR (ATR through the previous bar), trade AGAINST it: enter at the next open, exit at the close of the 4th bar after the spike.
//---        2 = when the signs of the last 1, 4, 24 and 120 hour returns all agree, trade WITH them: enter at the next open, exit at the close 24 bars after the signal bar. One trade at a time.
//--- Only trades whose ENTRY bar starts at or after `start` and that have closed (full holding period available) count.
void AT24FL_Run(const int rule, const int param, const int n, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[],
                const int &hr[], const datetime start, AT24FL_Stat &st)
  {
   st.n = 0; st.meanBp = 0.0; st.sdBp = 0.0; st.t = 0.0; st.hitPct = 0.0; st.cumBp = 0.0; st.meanDir = 0.0; st.driftBp = 0.0; st.hold = 1.0; st.adjMeanBp = 0.0; st.tAdj = 0.0;
   double atr[]; AT24FL_Atr(n, high, low, close, 14, atr);
   //--- the market's own drift per bar since registration
   double ds = 0.0; int dn = 0;
   for(int i = 0; i < n; i++) if(time[i] >= start) { ds += MathLog(close[i] / open[i]); dn++; }
   st.driftBp = dn > 0 ? 1e4 * ds / dn : 0.0;
   double sum = 0.0, sum2 = 0.0, sumDir = 0.0; int cnt = 0, hit = 0;
   int lastExit = -1;
   st.hold = (rule == 0) ? 1.0 : (rule == 1 ? 4.0 : 24.0);
   for(int i = 15; i < n; i++)
     {
      int entry = -1, exitBar = -1, dir = 0;
      if(rule == 0)
        {
         if(hr[i] == param && time[i] >= start) { entry = i; exitBar = i; dir = 1; }
        }
      else if(rule == 1)
        {
         double body = close[i] - open[i];
         if(atr[i - 1] > 0.0 && MathAbs(body) >= 2.5 * atr[i - 1] && i + 4 < n && time[i + 1] >= start) { entry = i + 1; exitBar = i + 4; dir = (body > 0.0) ? -1 : 1; }
        }
      else if(rule == 2)
        {
         if(i < 120 || i + 24 >= n) continue;
         int s = 0;
         s += (close[i] > close[i - 1]) ? 1 : -1;
         s += (close[i] > close[i - 4]) ? 1 : -1;
         s += (close[i] > close[i - 24]) ? 1 : -1;
         s += (close[i] > close[i - 120]) ? 1 : -1;
         if(MathAbs(s) == 4 && time[i + 1] >= start) { entry = i + 1; exitBar = i + 24; dir = (s > 0) ? 1 : -1; }
        }
      if(entry < 0 || exitBar >= n || entry <= lastExit) continue;
      double r = 1e4 * dir * MathLog(close[exitBar] / open[entry]);
      lastExit = exitBar;
      cnt++; sum += r; sum2 += r * r; sumDir += dir; if(r > 0.0) hit++;
     }
   st.n = cnt; st.cumBp = sum;
   if(cnt > 0)
     {
      st.meanBp = sum / cnt; st.meanDir = sumDir / cnt; st.hitPct = 100.0 * hit / cnt;
      if(cnt > 1)
        {
         double var = (sum2 - cnt * st.meanBp * st.meanBp) / (cnt - 1);
         st.sdBp = MathSqrt(MathMax(var, 0.0));
         if(st.sdBp > 0.0)
           {
            st.t = st.meanBp / (st.sdBp / MathSqrt((double)cnt));
            st.adjMeanBp = st.meanBp - st.meanDir * st.hold * st.driftBp;
            st.tAdj = st.adjMeanBp / (st.sdBp / MathSqrt((double)cnt));
           }
        }
     }
  }

//--- rule 3 (R4, registered 2026-11-11): session relay. Direction = sign of the previous trading day's New York session return (GMT 13:00-21:00, at least 6 bars);
//--- trade the Asian session of the next trading day (GMT day, first bar at GMT hour 0 or 1, exit at the close of the last bar before GMT 07:00, at least 6 bars) WITH that direction.
//--- gmh = GMT hour of each bar, gmd = GMT day number. Only trades whose entry bar starts at or after `start` count. Needs full history after `start`.
void AT24FL_RunRelay(const int n, const datetime &time[], const double &open[], const double &close[], const int &gmh[], const long &gmd[], const datetime start, AT24FL_Stat &st)
  {
   st.n = 0; st.meanBp = 0.0; st.sdBp = 0.0; st.t = 0.0; st.hitPct = 0.0; st.cumBp = 0.0; st.meanDir = 0.0; st.driftBp = 0.0; st.hold = 7.0; st.adjMeanBp = 0.0; st.tAdj = 0.0;
   double ds = 0.0; int dn = 0;
   for(int i = 0; i < n; i++) if(time[i] >= start) { ds += MathLog(close[i] / open[i]); dn++; }
   st.driftBp = dn > 0 ? 1e4 * ds / dn : 0.0;
   double sum = 0.0, sum2 = 0.0, sumDir = 0.0, sumHoldDir = 0.0; int cnt = 0, hit = 0;
   double prevNy = 0.0; int prevNyBars = 0; bool havePrev = false;
   int i = 0;
   while(i < n)
     {
      int j = i; while(j < n && gmd[j] == gmd[i]) j++;
      //--- Asian session of this day: bars with GMT hour < 7
      int a0 = -1, a1 = -1, ac = 0;
      for(int k = i; k < j; k++) if(gmh[k] < 7) { if(a0 < 0) a0 = k; a1 = k; ac++; }
      if(havePrev && prevNyBars >= 6 && prevNy != 0.0 && a0 == i && gmh[a0] <= 1 && ac >= 6 && time[a0] >= start)
        {
         int dir = prevNy > 0.0 ? 1 : -1;
         double r = 1e4 * dir * MathLog(close[a1] / open[a0]);
         int hold = a1 - a0 + 1;
         cnt++; sum += r; sum2 += r * r; sumDir += dir; sumHoldDir += (double)dir * hold; if(r > 0.0) hit++;
        }
      //--- New York session of this day for the next day's relay
      double ny = 0.0; int nb = 0;
      for(int k = i; k < j; k++) if(gmh[k] >= 13 && gmh[k] < 21) { ny += MathLog(close[k] / open[k]); nb++; }
      prevNy = ny; prevNyBars = nb; havePrev = true;
      i = j;
     }
   st.n = cnt; st.cumBp = sum;
   if(cnt > 0)
     {
      st.meanBp = sum / cnt; st.meanDir = sumDir / cnt; st.hitPct = 100.0 * hit / cnt;
      if(cnt > 1)
        {
         double var = (sum2 - cnt * st.meanBp * st.meanBp) / (cnt - 1);
         st.sdBp = MathSqrt(MathMax(var, 0.0));
         if(st.sdBp > 0.0)
           {
            st.t = st.meanBp / (st.sdBp / MathSqrt((double)cnt));
            st.adjMeanBp = st.meanBp - (sumHoldDir / cnt) * st.driftBp;
            st.tAdj = st.adjMeanBp / (st.sdBp / MathSqrt((double)cnt));
           }
        }
     }
  }

#endif // AT24_FL_CORE_MQH
