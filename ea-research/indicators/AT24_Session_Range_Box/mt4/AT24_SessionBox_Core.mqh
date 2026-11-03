//+------------------------------------------------------------------+
//| AT24_SessionBox_Core.mqh                                         |
//| Session (Asia) range box maths. Pure: no chart or account calls.|
//| Arrays are chronological (index 0 = oldest). Times are          |
//| converted to GMT with `offsetSec` (server time - GMT).          |
//+------------------------------------------------------------------+
#ifndef AT24_SESSIONBOX_CORE_MQH
#define AT24_SESSIONBOX_CORE_MQH

#define AT24SB_MAXDAYS 400

//--- Per-day results (parallel arrays, chronological)
//--- brk: 0 none, 1 up, 2 down (first close beyond the box after the session ended)
//--- held: 1 final close still beyond the box on the break side, 0 not, -1 unknown (day not finished / no break)
//--- ext: best excursion after the break, in box sizes
struct AT24SB_Day
  {
   datetime boxStart;     // first bar of the Asia window (server time)
   datetime boxEnd;       // end of the Asia window (server time)
   datetime dayEnd;       // end of the monitoring window (server time)
   double   hi, lo;
   int      brk;
   datetime brkTime;
   int      held;
   double   ext;
   bool     complete;     // Asia window finished
   bool     finished;     // monitoring window finished
   int      key;          // GMT date yyyymmdd
  };

int AT24SB_GmtKey(const datetime t, const int offsetSec)
  {
   MqlDateTime m; TimeToStruct(t - offsetSec, m);
   return m.year * 10000 + m.mon * 100 + m.day;
  }

int AT24SB_GmtMinute(const datetime t, const int offsetSec)
  {
   MqlDateTime m; TimeToStruct(t - offsetSec, m);
   return m.hour * 60 + m.min;
  }

//--- Analyse the last `maxDays` GMT days. Returns the number of days written to `d` (oldest first).
int AT24SB_Analyze(const int total, const datetime &time[], const double &high[], const double &low[], const double &close[],
                   const int offsetSec, const int asStartMin, const int asEndMin, const int dayEndMin,
                   const double buf, const int maxDays, AT24SB_Day &d[])
  {
   ArrayResize(d, 0);
   if(total < 10 || asEndMin <= asStartMin || dayEndMin <= asEndMin) return 0;
   datetime from = time[total - 1] - (datetime)((long)(maxDays + 1) * 86400);
   int i0 = total - 1;
   while(i0 > 0 && time[i0 - 1] >= from) i0--;
   int n = 0, curKey = -1;
   double lastClose = 0.0; bool haveLast = false;
   for(int i = i0; i < total; i++)
     {
      int key = AT24SB_GmtKey(time[i], offsetSec);
      int m = AT24SB_GmtMinute(time[i], offsetSec);
      if(key != curKey)
        {
         //--- close the previous day
         if(n > 0 && !d[n - 1].finished)
           {
            d[n - 1].finished = true;
            if(d[n - 1].brk == 1)      d[n - 1].held = (haveLast && lastClose > d[n - 1].hi) ? 1 : 0;
            else if(d[n - 1].brk == 2) d[n - 1].held = (haveLast && lastClose < d[n - 1].lo) ? 1 : 0;
           }
         curKey = key; haveLast = false;
         if(n >= AT24SB_MAXDAYS) break;
         ArrayResize(d, n + 1);
         d[n].boxStart = 0; d[n].boxEnd = 0; d[n].dayEnd = 0; d[n].hi = 0; d[n].lo = 0;
         d[n].brk = 0; d[n].brkTime = 0; d[n].held = -1; d[n].ext = 0; d[n].complete = false; d[n].finished = false; d[n].key = key;
         n++;
        }
      int k = n - 1;
      if(m >= asStartMin && m < asEndMin)
        {
         if(d[k].boxStart == 0) { d[k].boxStart = time[i]; d[k].hi = high[i]; d[k].lo = low[i]; }
         else { if(high[i] > d[k].hi) d[k].hi = high[i]; if(low[i] < d[k].lo) d[k].lo = low[i]; }
         d[k].boxEnd = time[i];
        }
      else if(m >= asEndMin && m < dayEndMin && d[k].boxStart != 0)
        {
         d[k].complete = true;
         double size = d[k].hi - d[k].lo;
         if(d[k].brk == 0)
           {
            if(close[i] > d[k].hi + buf)      { d[k].brk = 1; d[k].brkTime = time[i]; }
            else if(close[i] < d[k].lo - buf) { d[k].brk = 2; d[k].brkTime = time[i]; }
           }
         if(d[k].brk != 0 && size > 0.0)
           {
            double e = (d[k].brk == 1) ? (high[i] - d[k].hi) / size : (d[k].lo - low[i]) / size;
            if(e > d[k].ext) d[k].ext = e;
           }
         lastClose = close[i]; haveLast = true;
        }
      if(m >= dayEndMin && d[k].boxStart != 0 && !d[k].finished)
        {
         d[k].finished = true;
         if(d[k].brk == 1)      d[k].held = (haveLast && lastClose > d[k].hi) ? 1 : 0;
         else if(d[k].brk == 2) d[k].held = (haveLast && lastClose < d[k].lo) ? 1 : 0;
        }
     }
   //--- fill window end times for drawing
   for(int j = 0; j < n; j++)
      if(d[j].boxStart != 0)
        {
         MqlDateTime s; TimeToStruct(d[j].boxStart - offsetSec, s);
         s.hour = 0; s.min = 0; s.sec = 0;
         datetime gmtMidnight = StructToTime(s);
         d[j].boxEnd = gmtMidnight + asEndMin * 60 + offsetSec;
         d[j].dayEnd = gmtMidnight + dayEndMin * 60 + offsetSec;
        }
   return n;
  }

//--- Statistics over finished days that have a box: out[0] valid days, [1] up-first %, [2] down-first %, [3] no-break %,
//--- [4] held % (of broken days), [5] ran >= 1 box size % (of broken days), [6] median box size
void AT24SB_Stats(const AT24SB_Day &d[], const int n, double &out[])
  {
   ArrayResize(out, 7);
   for(int z = 0; z < 7; z++) out[z] = 0.0;
   int v = 0, up = 0, dn = 0, nb = 0, held = 0, ran = 0, brokenN = 0;
   double sizes[]; ArrayResize(sizes, 0);
   for(int i = 0; i < n; i++)
     {
      if(!d[i].finished || d[i].boxStart == 0) continue;
      v++;
      int ns = ArraySize(sizes); ArrayResize(sizes, ns + 1); sizes[ns] = d[i].hi - d[i].lo;
      if(d[i].brk == 1) up++; else if(d[i].brk == 2) dn++; else nb++;
      if(d[i].brk != 0) { brokenN++; if(d[i].held == 1) held++; if(d[i].ext >= 1.0) ran++; }
     }
   out[0] = v;
   if(v > 0) { out[1] = 100.0 * up / v; out[2] = 100.0 * dn / v; out[3] = 100.0 * nb / v; }
   if(brokenN > 0) { out[4] = 100.0 * held / brokenN; out[5] = 100.0 * ran / brokenN; }
   int cnt = ArraySize(sizes);
   if(cnt > 0)
     {
      ArraySort(sizes);
      out[6] = (cnt % 2 == 1) ? sizes[cnt / 2] : 0.5 * (sizes[cnt / 2 - 1] + sizes[cnt / 2]);
     }
  }

string AT24SB_StateName(const AT24SB_Day &d)
  {
   if(d.boxStart == 0) return "NO ASIA DATA";
   if(!d.complete)     return "ASIA BOX FORMING";
   if(d.brk == 0)      return d.finished ? "NO BREAK TODAY" : "INSIDE THE BOX";
   string side = (d.brk == 1) ? "UP" : "DOWN";
   if(d.finished) return (d.held == 1) ? "BROKE " + side + " AND HELD" : "BROKE " + side + " THEN FAILED";
   return "BROKE " + side;
  }

#endif // AT24_SESSIONBOX_CORE_MQH
