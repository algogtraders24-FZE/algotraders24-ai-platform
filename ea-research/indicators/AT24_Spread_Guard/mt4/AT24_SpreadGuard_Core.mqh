//+------------------------------------------------------------------+
//| AT24_SpreadGuard_Core.mqh                                        |
//| Spread-by-hour maths shared by the indicator and its self-test.  |
//| Arrays are chronological (index 0 = oldest).                     |
//+------------------------------------------------------------------+
#ifndef AT24_SPREADGUARD_CORE_MQH
#define AT24_SPREADGUARD_CORE_MQH

//--- status ids: 0 n/a, 1 normal, 2 elevated, 3 spike
string AT24SG_StatusName(const int s)
  {
   switch(s)
     {
      case 1: return "SPREAD NORMAL";
      case 2: return "SPREAD ELEVATED";
      case 3: return "SPREAD SPIKE";
     }
   return "COLLECTING DATA";
  }

int AT24SG_HourOf(const datetime t, const int offsetSec)
  {
   MqlDateTime m;
   TimeToStruct(t - offsetSec, m);
   return m.hour;
  }

//--- Mean recorded bar spread (points) per GMT hour over the last `days` days. Returns bars used.
int AT24SG_Profile(const int total, const datetime &time[], const int &spread[], const int offsetSec, const int days,
                   double &avg[], int &cnt[])
  {
   double sum[24];
   ArrayResize(avg, 24);
   ArrayResize(cnt, 24);
   for(int h = 0; h < 24; h++) { sum[h] = 0.0; cnt[h] = 0; avg[h] = 0.0; }
   if(total <= 0) return 0;
   datetime from = time[total - 1] - (datetime)((long)days * 86400);
   int used = 0;
   for(int i = total - 1; i >= 0; i--)
     {
      if(time[i] < from) break;
      if(spread[i] <= 0) continue;
      int hh = AT24SG_HourOf(time[i], offsetSec);
      sum[hh] += spread[i];
      cnt[hh]++;
      used++;
     }
   for(int h2 = 0; h2 < 24; h2++) avg[h2] = (cnt[h2] > 0) ? sum[h2] / cnt[h2] : 0.0;
   return used;
  }

int AT24SG_Status(const double spread, const double hourAvg, const double okMult, const double spikeMult)
  {
   if(spread <= 0.0 || hourAvg <= 0.0) return 0;
   double r = spread / hourAvg;
   if(r <= okMult) return 1;
   if(r <= spikeMult) return 2;
   return 3;
  }

//--- Median of the hours that have data (reference for colouring the 24h mini chart)
double AT24SG_MedianAvg(const double &avg[], const int &cnt[])
  {
   double v[24];
   int n = 0;
   for(int h = 0; h < 24; h++) if(cnt[h] >= 5 && avg[h] > 0.0) { v[n] = avg[h]; n++; }
   if(n == 0) return 0.0;
   for(int a = 1; a < n; a++)
     {
      double key = v[a];
      int b = a - 1;
      while(b >= 0 && v[b] > key) { v[b + 1] = v[b]; b--; }
      v[b + 1] = key;
     }
   return (n % 2 == 1) ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
  }

//--- 3 cheapest and 3 costliest hours as text like "03, 05, 09"
void AT24SG_Extremes(const double &avg[], const int &cnt[], string &cheapest, string &costliest)
  {
   int idx[24];
   int n = 0;
   for(int h = 0; h < 24; h++) if(cnt[h] >= 5 && avg[h] > 0.0) { idx[n] = h; n++; }
   cheapest = "-"; costliest = "-";
   if(n < 6) return;
   for(int a = 1; a < n; a++)   // insertion sort by avg ascending
     {
      int key = idx[a];
      int b = a - 1;
      while(b >= 0 && avg[idx[b]] > avg[key]) { idx[b + 1] = idx[b]; b--; }
      idx[b + 1] = key;
     }
   cheapest = StringFormat("%02d, %02d, %02d", idx[0], idx[1], idx[2]);
   costliest = StringFormat("%02d, %02d, %02d", idx[n - 1], idx[n - 2], idx[n - 3]);
  }

#endif // AT24_SPREADGUARD_CORE_MQH
