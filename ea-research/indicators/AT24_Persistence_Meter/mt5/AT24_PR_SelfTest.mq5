//+------------------------------------------------------------------+
//| Self-test: variance ratios on real bars and the persistence      |
//| study. Dumps MQL5\Files\PR_selftest.csv for a Python check.     |
//+------------------------------------------------------------------+
#include "AT24_PR_Core.mqh"
void OnStart()
  {
   MqlRates rt[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, rt);
   if(n < 1000) { Print("PRTEST FAIL bars=", n); return; }
   double c[], r[];
   ArrayResize(c, n);
   for(int i = 0; i < n; i++) c[i] = rt[i].close;
   AT24PR_Returns(n, c, r);
   int W = 400, H = 32;
   int qs[3] = {4, 8, 16};
   double cur[3][2];
   for(int k = 0; k < 3; k++) { double vr, z; AT24PR_Vr(r, n - 1, W, qs[k], vr, z); cur[k][0] = vr; cur[k][1] = z; }
   //--- 30 spot checks across the history
   int f = FileOpen("PR_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, W, H);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(c[i], 3));
   for(int s = 0; s < 30; s++)
     {
      int t = W + 50 + s * 240;
      if(t >= n) break;
      for(int k = 0; k < 3; k++)
        {
         double vr, z; AT24PR_Vr(r, t, W, qs[k], vr, z);
         FileWrite(f, "vr", t, qs[k], DoubleToString(vr, 10), DoubleToString(z, 8), DoubleToString(AT24PR_Hurst(vr, qs[k]), 8));
        }
     }
   for(int k = 0; k < 3; k++) FileWrite(f, "now", qs[k], DoubleToString(cur[k][0], 10), DoubleToString(cur[k][1], 8));
   double st[];
   for(int k = 0; k < 3; k++)
     {
      AT24PR_Study(n, c, r, W, qs[k], H, H, 1.645, st);
      FileWrite(f, "study", qs[k], DoubleToString(st[0], 0), DoubleToString(st[1], 0), DoubleToString(st[2], 0), DoubleToString(st[3], 0), DoubleToString(st[4], 6), DoubleToString(st[5], 6), DoubleToString(st[6], 6), DoubleToString(st[7], 6));
      PrintFormat("PRTEST q=%d now VR=%.3f z=%.2f | samples all=%.0f trend=%.0f meanrev=%.0f random=%.0f | same-sign all=%.1f%% trend=%.1f%% meanrev=%.1f%% random=%.1f%%", qs[k], cur[k][0], cur[k][1], st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7]);
     }
   FileClose(f);
   Print("PRTEST done");
  }
