//+------------------------------------------------------------------+
//| Self-test: volatility estimators, EWMA forecasts and the         |
//| calibration study on real bars. Dumps MQL5\Files\VF_selftest.csv |
//| for an independent Python check.                                 |
//+------------------------------------------------------------------+
#include "AT24_VF_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("VFTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double v0[], v1[], v2[], v3[];
   AT24VF_PerBar(n, o, h, l, c, v0, v1, v2, v3);
   int H = 32, warm = 100, start = 200;
   double lam = 0.94;
   double s0[], s1[], s2[], s3[], atr[], nav[];
   AT24VF_Ewma(n, v0, lam, warm, s0); AT24VF_Ewma(n, v1, lam, warm, s1); AT24VF_Ewma(n, v2, lam, warm, s2); AT24VF_Ewma(n, v3, lam, warm, s3);
   AT24VF_AtrPct(n, h, l, c, 14, atr); AT24VF_Naive(n, v0, H, nav);
   int slot[]; ArrayResize(slot, n);
   int S = 86400 / PeriodSeconds(PERIOD_M15);
   for(int i = 0; i < n; i++) slot[i] = (int)(((long)r[i].time % 86400) / PeriodSeconds(PERIOD_M15));
   double sc[], sr[], lc[], lr[];
   AT24VF_Seasonal(n, slot, S, v0, lam, warm, H, sc, lc); AT24VF_Seasonal(n, slot, S, v3, lam, warm, H, sr, lr);
   double pctL = AT24VF_Percentile(lr, n - 1, 2000, lr[n - 1]);
   double q[8][4]; double out[];
   AT24VF_Calib(n, s0, v0, H, start, out); for(int k = 0; k < 4; k++) q[0][k] = out[k];
   AT24VF_Calib(n, s1, v0, H, start, out); for(int k = 0; k < 4; k++) q[1][k] = out[k];
   AT24VF_Calib(n, s2, v0, H, start, out); for(int k = 0; k < 4; k++) q[2][k] = out[k];
   AT24VF_Calib(n, s3, v0, H, start, out); for(int k = 0; k < 4; k++) q[3][k] = out[k];
   AT24VF_Calib(n, atr, v0, H, start, out); for(int k = 0; k < 4; k++) q[4][k] = out[k];
   AT24VF_Calib(n, nav, v0, H, start, out); for(int k = 0; k < 4; k++) q[5][k] = out[k];
   AT24VF_Calib(n, sc, v0, H, start, out); for(int k = 0; k < 4; k++) q[6][k] = out[k];
   AT24VF_Calib(n, sr, v0, H, start, out); for(int k = 0; k < 4; k++) q[7][k] = out[k];
   string nm[8] = {"cc_ewma", "parkinson_ewma", "gk_ewma", "rs_ewma", "atr14", "naive_prev_H", "cc_seasonal", "rs_seasonal"};
   for(int e = 0; e < 8; e++) PrintFormat("VFTEST %-15s n=%.0f corr=%.4f bias=%.4f within30=%.1f%%", nm[e], q[e][0], q[e][1], q[e][2], q[e][3]);
   double pct = AT24VF_Percentile(s3, n - 1, 2000, s3[n - 1]);
   PrintFormat("VFTEST last sigma rs=%.6f pct=%.1f", s3[n - 1], pct);
   int f = FileOpen("VF_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, H, warm, start, lam);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int e = 0; e < 8; e++) FileWrite(f, "calib", nm[e], DoubleToString(q[e][0], 0), DoubleToString(q[e][1], 8), DoubleToString(q[e][2], 8), DoubleToString(q[e][3], 6));
   FileWrite(f, "last", DoubleToString(s0[n - 1], 10), DoubleToString(s1[n - 1], 10), DoubleToString(s2[n - 1], 10), DoubleToString(s3[n - 1], 10), DoubleToString(atr[n - 1], 10), DoubleToString(nav[n - 1], 10), DoubleToString(pct, 6), DoubleToString(sc[n - 1], 10), DoubleToString(sr[n - 1], 10), DoubleToString(lr[n - 1], 10), DoubleToString(pctL, 6));
   FileClose(f);
   Print("VFTEST done");
  }
