//+------------------------------------------------------------------+
//| AT24_VP_Core.mqh                                                 |
//| Daily volume profile from tick volume: POC, value area (VAH /    |
//| VAL), and how price treated the previous day's levels, against   |
//| mirrored control levels. Server-time days. Closed bars only.     |
//| Pure maths, chronological arrays.                                |
//+------------------------------------------------------------------+
#ifndef AT24_VP_CORE_MQH
#define AT24_VP_CORE_MQH

struct AT24VP_Day
  {
   int    first;     // first bar of the day
   int    last;      // last bar of the day in the data
   double hi;
   double lo;
   double poc;       // price of the busiest bin (bin centre)
   double vah;       // top of the value area
   double val;       // bottom of the value area
   bool   ok;        // profile computed (day has volume and a range)
  };

//--- split into server days and build each day's profile with `bins` price bins. The volume of a bar is spread evenly over the
//--- bins its high-low range covers. Value area: start at the POC bin and keep adding the larger neighbouring bin
//--- (ties: the upper one) until `vaPct` of the day's volume is inside.
int AT24VP_Days(const int n, const datetime &time[], const double &high[], const double &low[], const double &vol[], const int bins, const double vaPct, AT24VP_Day &d[])
  {
   ArrayResize(d, 0);
   int cnt = 0;
   long cur = -1;
   for(int i = 0; i < n; i++)
     {
      long dk = (long)time[i] / 86400;
      if(dk != cur)
        {
         cur = dk;
         ArrayResize(d, cnt + 1);
         d[cnt].first = i; d[cnt].last = i; d[cnt].hi = high[i]; d[cnt].lo = low[i]; d[cnt].poc = 0.0; d[cnt].vah = 0.0; d[cnt].val = 0.0; d[cnt].ok = false;
         cnt++;
        }
      else
        {
         int k = cnt - 1;
         d[k].last = i;
         if(high[i] > d[k].hi) d[k].hi = high[i];
         if(low[i] < d[k].lo) d[k].lo = low[i];
        }
     }
   for(int k = 0; k < cnt; k++)
     {
      double rng = d[k].hi - d[k].lo;
      if(rng <= 0.0) continue;
      double bw = rng / bins;
      double prof[]; ArrayResize(prof, bins);
      for(int b = 0; b < bins; b++) prof[b] = 0.0;
      double total = 0.0;
      for(int i = d[k].first; i <= d[k].last; i++)
        {
         double v = vol[i];
         if(v <= 0.0) continue;
         double lo = low[i], hi = high[i];
         total += v;
         if(hi - lo <= 0.0)
           {
            int b0 = (int)MathMin((double)(bins - 1), MathFloor((lo - d[k].lo) / bw));
            prof[b0] += v;
            continue;
           }
         int b1 = (int)MathMin((double)(bins - 1), MathFloor((lo - d[k].lo) / bw));
         int b2 = (int)MathMin((double)(bins - 1), MathFloor((hi - d[k].lo) / bw));
         for(int b = b1; b <= b2; b++)
           {
            double bl = d[k].lo + b * bw, bh = bl + bw;
            double ov = MathMin(hi, bh) - MathMax(lo, bl);
            if(ov > 0.0) prof[b] += v * ov / (hi - lo);
           }
        }
      if(total <= 0.0) continue;
      int pb = 0;
      for(int b = 1; b < bins; b++) if(prof[b] > prof[pb]) pb = b;
      int lo = pb, up = pb;
      double acc = prof[pb];
      while(acc < vaPct * total && (lo > 0 || up < bins - 1))
        {
         double dn = (lo > 0) ? prof[lo - 1] : -1.0, ab = (up < bins - 1) ? prof[up + 1] : -1.0;
         if(ab >= dn) { up++; acc += prof[up]; }
         else { lo--; acc += prof[lo]; }
        }
      d[k].poc = d[k].lo + (pb + 0.5) * bw;
      d[k].vah = d[k].lo + (up + 1) * bw;
      d[k].val = d[k].lo + lo * bw;
      d[k].ok = true;
     }
   return cnt;
  }

//--- for each day k >= 1 with a previous profile: levels POC/VAH/VAL of day k-1 against day k's bars.
//--- touch = a bar's range contains the level. Control level = mirrored through the day's open (open + (open - level)).
//--- reaction: after the first touch, within `look` bars (same day) the close moves `frac` x previous-day range away from the level
//--- on the side the day opened (reacted) before closing `frac` x that range beyond it on the other side (broke).
//--- out[l*6+0] days, +1 touch %, +2 control touch %, +3 reacted % of decided touches, +4 control reacted %, +5 decided touches
void AT24VP_Study(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const AT24VP_Day &d[], const int cnt, const int look, const double frac, double &out[])
  {
   ArrayResize(out, 18);
   for(int z = 0; z < 18; z++) out[z] = 0.0;
   for(int l = 0; l < 3; l++)
     {
      int days = 0, touch = 0, ctouch = 0, react = 0, decided = 0, creact = 0, cdecided = 0;
      for(int k = 1; k < cnt; k++)
        {
         if(!d[k - 1].ok) continue;
         double lvl = (l == 0) ? d[k - 1].poc : ((l == 1) ? d[k - 1].vah : d[k - 1].val);
         double R = d[k - 1].hi - d[k - 1].lo;
         double op = open[d[k].first];
         if(op == lvl) continue;
         days++;
         for(int pass = 0; pass < 2; pass++)
           {
            double L = (pass == 0) ? lvl : op + (op - lvl);
            double s = (op > L) ? 1.0 : -1.0;
            int tb = -1;
            for(int i = d[k].first; i <= d[k].last; i++) if(low[i] <= L && high[i] >= L) { tb = i; break; }
            if(tb < 0) continue;
            if(pass == 0) touch++; else ctouch++;
            int res = 0;     // 1 reacted, -1 broke
            for(int u = tb; u <= MathMin(d[k].last, tb + look); u++)
              {
               double away = (close[u] - L) * s, beyond = (close[u] - L) * (-s);
               if(away >= frac * R) { res = 1; break; }
               if(beyond >= frac * R) { res = -1; break; }
              }
            if(res != 0)
              {
               if(pass == 0) { decided++; if(res == 1) react++; }
               else { cdecided++; if(res == 1) creact++; }
              }
           }
        }
      out[l * 6 + 0] = days;
      if(days > 0) { out[l * 6 + 1] = 100.0 * touch / days; out[l * 6 + 2] = 100.0 * ctouch / days; }
      out[l * 6 + 3] = decided > 0 ? 100.0 * react / decided : 0.0;
      out[l * 6 + 4] = cdecided > 0 ? 100.0 * creact / cdecided : 0.0;
      out[l * 6 + 5] = decided;
     }
  }

#endif // AT24_VP_CORE_MQH
