//+------------------------------------------------------------------+
//| AT24_Levels_Core.mqh                                             |
//| Previous day / week / month high-low levels and what price did   |
//| to them. Pure maths: no chart calls. Arrays are chronological.   |
//+------------------------------------------------------------------+
#ifndef AT24_LEVELS_CORE_MQH
#define AT24_LEVELS_CORE_MQH

#define AT24LV_MAXP 400

//--- one calendar period (day / week / month, GMT) and its dealings with the PREVIOUS period's high/low
struct AT24LV_Period
  {
   int      key;
   datetime start, end;        // first / last bar time (server time)
   double   hi, lo, cl;        // this period's own high, low, last close so far
   double   pHi, pLo;          // previous period's high / low = the levels in play (0 = none)
   datetime swHiT, swLoT;      // first bar whose HIGH went above pHi / LOW went below pLo (wick sweep)
   datetime clHiT, clLoT;      // first bar that CLOSED above pHi / below pLo
   int      outHi, outLo;      // at period end: 0 untouched, 1 swept and closed back inside, 2 accepted (closed beyond)
   bool     finished;
  };

//--- mode 0 = day, 1 = week (Monday start), 2 = month
int AT24LV_Key(const datetime t, const int offsetSec, const int mode)
  {
   datetime g = t - offsetSec;
   if(mode == 0) { MqlDateTime m; TimeToStruct(g, m); return m.year * 10000 + m.mon * 100 + m.day; }
   if(mode == 1) { long d = (long)g / 86400; return (int)(d - (d + 3) % 7); }
   MqlDateTime q; TimeToStruct(g, q); return q.year * 100 + q.mon;
  }

long AT24LV_Seconds(const int mode) { return (mode == 0) ? 86400 : (mode == 1 ? 7 * 86400 : 31 * 86400); }

int AT24LV_Analyze(const int total, const datetime &time[], const double &high[], const double &low[], const double &close[],
                   const int offsetSec, const int mode, const int maxPeriods, AT24LV_Period &p[])
  {
   ArrayResize(p, 0);
   if(total < 10) return 0;
   datetime from = time[total - 1] - (datetime)(AT24LV_Seconds(mode) * (long)(maxPeriods + 1));
   int i0 = total - 1;
   while(i0 > 0 && time[i0 - 1] >= from) i0--;
   //--- start at the first bar of a period so the first period is complete (its high/low become the next period's levels)
   while(i0 > 0 && AT24LV_Key(time[i0 - 1], offsetSec, mode) == AT24LV_Key(time[i0], offsetSec, mode)) i0--;
   int n = 0, curKey = -2147483647;
   for(int i = i0; i < total; i++)
     {
      int key = AT24LV_Key(time[i], offsetSec, mode);
      if(key != curKey)
        {
         if(n > 0)
           {
            p[n - 1].finished = true;
            if(p[n - 1].pHi > 0.0)
              {
               if(p[n - 1].swHiT != 0) p[n - 1].outHi = (p[n - 1].cl <= p[n - 1].pHi) ? 1 : 2;
               if(p[n - 1].swLoT != 0) p[n - 1].outLo = (p[n - 1].cl >= p[n - 1].pLo) ? 1 : 2;
              }
           }
         if(n >= AT24LV_MAXP) break;
         double ph = (n > 0) ? p[n - 1].hi : 0.0, pl = (n > 0) ? p[n - 1].lo : 0.0;
         ArrayResize(p, n + 1);
         p[n].key = key; p[n].start = time[i]; p[n].end = time[i];
         p[n].hi = high[i]; p[n].lo = low[i]; p[n].cl = close[i];
         p[n].pHi = ph; p[n].pLo = pl;
         p[n].swHiT = 0; p[n].swLoT = 0; p[n].clHiT = 0; p[n].clLoT = 0;
         p[n].outHi = 0; p[n].outLo = 0; p[n].finished = false;
         curKey = key;
         n++;
        }
      int k = n - 1;
      p[k].end = time[i];
      if(high[i] > p[k].hi) p[k].hi = high[i];
      if(low[i] < p[k].lo) p[k].lo = low[i];
      p[k].cl = close[i];
      if(p[k].pHi > 0.0)
        {
         if(p[k].swHiT == 0 && high[i] > p[k].pHi) p[k].swHiT = time[i];
         if(p[k].swLoT == 0 && low[i] < p[k].pLo)  p[k].swLoT = time[i];
         if(p[k].clHiT == 0 && close[i] > p[k].pHi) p[k].clHiT = time[i];
         if(p[k].clLoT == 0 && close[i] < p[k].pLo) p[k].clLoT = time[i];
        }
     }
   return n;
  }

//--- state of one level inside the current period: 0 untouched, 1 swept and back inside, 2 accepted beyond the level
int AT24LV_StateHi(const AT24LV_Period &c) { if(c.pHi <= 0.0 || c.swHiT == 0) return 0; return (c.cl > c.pHi) ? 2 : 1; }
int AT24LV_StateLo(const AT24LV_Period &c) { if(c.pLo <= 0.0 || c.swLoT == 0) return 0; return (c.cl < c.pLo) ? 2 : 1; }

string AT24LV_StateName(const int s) { return (s == 0) ? "untouched" : (s == 1 ? "swept, back inside" : "accepted beyond"); }

//--- Statistics over finished periods that have a previous period: out[0] periods, [1] % swept high, [2] % swept low,
//--- [3] % either, [4] % both, [5] % of sweeps that closed back inside, [6] % of sweeps accepted, [7] sweeps counted
void AT24LV_Stats(const AT24LV_Period &p[], const int n, double &out[])
  {
   ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   int v = 0, sh = 0, sl = 0, ei = 0, bo = 0, rej = 0, acc = 0;
   for(int i = 0; i < n; i++)
     {
      if(!p[i].finished || p[i].pHi <= 0.0) continue;
      v++;
      bool a = (p[i].swHiT != 0), b = (p[i].swLoT != 0);
      if(a) sh++;
      if(b) sl++;
      if(a || b) ei++;
      if(a && b) bo++;
      if(p[i].outHi == 1) rej++; else if(p[i].outHi == 2) acc++;
      if(p[i].outLo == 1) rej++; else if(p[i].outLo == 2) acc++;
     }
   out[0] = v;
   if(v > 0) { out[1] = 100.0 * sh / v; out[2] = 100.0 * sl / v; out[3] = 100.0 * ei / v; out[4] = 100.0 * bo / v; }
   int sw = rej + acc;
   out[7] = sw;
   if(sw > 0) { out[5] = 100.0 * rej / sw; out[6] = 100.0 * acc / sw; }
  }

#endif // AT24_LEVELS_CORE_MQH
