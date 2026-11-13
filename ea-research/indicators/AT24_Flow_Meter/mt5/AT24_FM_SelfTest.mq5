//+------------------------------------------------------------------+
//| Self-test: the three delta modes. Real Binance BTCUSDT trades    |
//| (price, quantity, aggressor side) from MQL5\Files\fm_trades.csv  |
//| give REAL (flags) and TICK-RULE per minute; XAUUSD H1 bars give  |
//| the BAR PROXY; daily-restart cumulative delta on the bars.       |
//| Dumps MQL5\Files\FM_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_FM_Core.mqh"
void OnStart()
  {
   int h = FileOpen("fm_trades.csv", FILE_READ | FILE_CSV | FILE_ANSI, ',');
   if(h == INVALID_HANDLE) { Print("FMTEST no trades file"); return; }
   long ts[]; double px[], vl[]; int fl[]; int nt = 0;
   ArrayResize(ts, 200000); ArrayResize(px, 200000); ArrayResize(vl, 200000); ArrayResize(fl, 200000);
   while(!FileIsEnding(h))
     {
      string a = FileReadString(h); if(a == "") break;
      ts[nt] = StringToInteger(a); px[nt] = StringToDouble(FileReadString(h)); vl[nt] = StringToDouble(FileReadString(h)); fl[nt] = (int)StringToInteger(FileReadString(h)); nt++;
     }
   FileClose(h);
   long t0 = ((ts[0] / 60) + 1) * 60;                       // first full minute
   int nb = (int)((ts[nt - 1] - t0) / 60);                  // complete minutes
   double dReal[], dTick[]; int cReal[], cTick[]; ArrayResize(dReal, nb); ArrayResize(dTick, nb); ArrayResize(cReal, nb); ArrayResize(cTick, nb);
   AT24FM_TickDelta(nt, ts, px, vl, fl, t0, 60, nb, true, dReal, cReal);
   AT24FM_TickDelta(nt, ts, px, vl, fl, t0, 60, nb, false, dTick, cTick);
   int f = FileOpen("FM_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", nt, (long)t0, nb);
   for(int i = 0; i < nt; i++) FileWrite(f, "tick", ts[i], DoubleToString(px[i], 2), DoubleToString(vl[i], 8), fl[i]);
   for(int b = 0; b < nb; b++) FileWrite(f, "real", b, DoubleToString(dReal[b], 8), cReal[b], DoubleToString(dTick[b], 8), cTick[b]);
   //--- bar proxy and daily cumulative delta on real gold bars
   MqlRates r[]; int n = CopyRates("XAUUSD", PERIOD_H1, 1, 3000, r);
   if(n > 500)
     {
      double o[], hh[], l[], c[], dp[], cum[]; long tv[]; datetime tm[]; ArrayResize(o, n); ArrayResize(hh, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(dp, n); ArrayResize(cum, n); ArrayResize(tv, n); ArrayResize(tm, n);
      for(int i = 0; i < n; i++) { o[i] = r[i].open; hh[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; tv[i] = r[i].tick_volume; tm[i] = r[i].time; }
      AT24FM_BarProxy(n, o, hh, l, c, tv, dp); AT24FM_CumDaily(n, tm, dp, cum);
      for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)tm[i], DoubleToString(o[i], 3), DoubleToString(hh[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), tv[i], DoubleToString(dp[i], 6), DoubleToString(cum[i], 6));
     }
   FileClose(f);
   double sr = 0, st = 0; for(int b = 0; b < nb; b++) { sr += dReal[b]; st += dTick[b]; }
   PrintFormat("FMTEST trades=%d minutes=%d sumReal=%.3f sumTick=%.1f bars=%d", nt, nb, sr, st, n);
   Print("FMTEST done");
  }
