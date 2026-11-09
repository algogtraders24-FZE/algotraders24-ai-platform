//+------------------------------------------------------------------+
//| AT24_SW_Core.mqh                                                 |
//| Asian-range sweeps graded in R, honestly: reversal trade, the    |
//| mirror (continuation) trade and their average (= a random        |
//| direction), all with costs. Closed H1 bars. Pure maths.          |
//+------------------------------------------------------------------+
#ifndef AT24_SW_CORE_MQH
#define AT24_SW_CORE_MQH

struct AT24SW_Event
  {
   int      bar;       // the sweep bar (bar that traded beyond the range and closed back inside)
   long     day;       // GMT day number
   int      dir;       // reversal direction (+1 long after a sweep of the low, -1 short after a sweep of the high)
   double   ext;       // sweep extreme
   double   entry;     // open of the next bar
   double   risk;      // |entry - ext| in price units (1 R)
   double   rev;       // net R of the reversal trade
   double   cont;      // net R of the continuation (mirror) trade
   double   asiaHi;
   double   asiaLo;
   int      asiaFirst; // first bar of the Asian range
  };

//--- one trade: enter at the open of bar idx+1 in direction d, stop at `stop`, target one `risk` away, time exit at the first bar of GMT hour >= exitHour or after maxBars,
//--- a stop wins a same-bar tie. Returns the net R after `cost` (price units).
double AT24SW_Sim(const int n, const long &gday[], const int &ghour[], const double &open[], const double &high[], const double &low[], const double &close[],
                  const int idx, const int d, const double stop, const double risk, const double cost, const int exitHour, const int maxBars)
  {
   double entry = open[idx + 1];
   double target = entry + d * risk;
   double res = 0.0; bool done = false;
   for(int j = idx + 1; j < MathMin(idx + 1 + maxBars, n); j++)
     {
      if(gday[j] != gday[idx] || ghour[j] >= exitHour) { res = (j > idx + 1) ? (open[j] - entry) * d : 0.0; done = true; break; }
      bool hitStop = (d == 1) ? (low[j] <= stop) : (high[j] >= stop);
      bool hitTgt = (d == 1) ? (high[j] >= target) : (low[j] <= target);
      if(hitStop) { res = -risk; done = true; break; }
      if(hitTgt) { res = risk; done = true; break; }
     }
   if(!done) res = (close[MathMin(idx + maxBars, n - 1)] - entry) * d;
   return (res - cost) / risk;
  }

//--- events: Asian range = bars with GMT hour < asiaEnd (at least 6); sweep window = GMT hours asiaEnd .. winEnd (at least 4 bars).
//--- the first bar in the window that trades beyond one side and closes back inside is the sweep (a bar that does both sides ends the search).
int AT24SW_Find(const int n, const long &gday[], const int &ghour[], const double &open[], const double &high[], const double &low[], const double &close[],
                const int asiaEnd, const int winEnd, const int exitHour, const double cost, const double minRisk, AT24SW_Event &ev[])
  {
   ArrayResize(ev, 0);
   int cnt = 0, i = 0;
   while(i < n)
     {
      long dk = gday[i]; int j = i;
      while(j < n && gday[j] == dk) j++;
      //--- bars [i, j) are one GMT day
      int na = 0, nw = 0; double hi = -1e300, lo = 1e300; int first = -1;
      for(int k = i; k < j; k++)
         if(ghour[k] < asiaEnd) { na++; if(first < 0) first = k; if(high[k] > hi) hi = high[k]; if(low[k] < lo) lo = low[k]; }
         else if(ghour[k] <= winEnd) nw++;
      if(na >= 6 && nw >= 4)
        {
         int sweepBar = -1, d = 0; double ext = 0.0;
         for(int k = i; k < j; k++)
           {
            if(ghour[k] < asiaEnd || ghour[k] > winEnd) continue;
            bool up = (high[k] > hi && close[k] <= hi), dn = (low[k] < lo && close[k] >= lo);
            if(up && dn) break;
            if(up) { sweepBar = k; d = -1; ext = high[k]; break; }
            if(dn) { sweepBar = k; d = 1; ext = low[k]; break; }
           }
         if(sweepBar >= 0 && sweepBar + 1 < n && gday[sweepBar + 1] == dk)
           {
            double entry = open[sweepBar + 1], risk = MathAbs(entry - ext);
            if(risk > minRisk)
              {
               ArrayResize(ev, cnt + 1);
               ev[cnt].bar = sweepBar; ev[cnt].day = dk; ev[cnt].dir = d; ev[cnt].ext = ext; ev[cnt].entry = entry; ev[cnt].risk = risk;
               ev[cnt].asiaHi = hi; ev[cnt].asiaLo = lo; ev[cnt].asiaFirst = first;
               ev[cnt].rev = AT24SW_Sim(n, gday, ghour, open, high, low, close, sweepBar, d, ext, risk, cost, exitHour, 11);
               ev[cnt].cont = AT24SW_Sim(n, gday, ghour, open, high, low, close, sweepBar, -d, entry + d * risk, risk, cost, exitHour, 11);
               cnt++;
              }
           }
        }
      i = j;
     }
   return cnt;
  }

//--- out: [0] events, [1] mean reversal R, [2] t, [3] hit % , [4] mean continuation R, [5] t, [6] hit %, [7] mean control R (average of the two = random direction),
//--- [8] reversal minus control (mean R), [9] its t-statistic, [10] median risk in price units
void AT24SW_Stats(const AT24SW_Event &ev[], const int m, const int from, double &out[])
  {
   ArrayResize(out, 11);
   for(int z = 0; z < 11; z++) out[z] = 0.0;
   int n = 0; double sr = 0, sr2 = 0, sc = 0, sc2 = 0, sd_ = 0, sd2 = 0; int hr = 0, hc = 0;
   double risks[]; ArrayResize(risks, 0);
   for(int k = from; k < m; k++)
     {
      double r = ev[k].rev, c = ev[k].cont, d = (ev[k].rev - ev[k].cont) / 2.0;
      n++; sr += r; sr2 += r * r; sc += c; sc2 += c * c; sd_ += d; sd2 += d * d;
      if(r > 0) hr++;
      if(c > 0) hc++;
      int a = ArraySize(risks); ArrayResize(risks, a + 1); risks[a] = ev[k].risk;
     }
   out[0] = n;
   if(n < 3) return;
   double mr = sr / n, mc = sc / n, md = sd_ / n;
   double vr = (sr2 - n * mr * mr) / (n - 1), vc = (sc2 - n * mc * mc) / (n - 1), vd = (sd2 - n * md * md) / (n - 1);
   out[1] = mr; out[2] = vr > 0 ? mr / MathSqrt(vr / n) : 0.0; out[3] = 100.0 * hr / n;
   out[4] = mc; out[5] = vc > 0 ? mc / MathSqrt(vc / n) : 0.0; out[6] = 100.0 * hc / n;
   out[7] = (mr + mc) / 2.0; out[8] = md; out[9] = vd > 0 ? md / MathSqrt(vd / n) : 0.0;
   ArraySort(risks);
   out[10] = (n % 2 == 1) ? risks[n / 2] : 0.5 * (risks[n / 2 - 1] + risks[n / 2]);
  }

#endif // AT24_SW_CORE_MQH
