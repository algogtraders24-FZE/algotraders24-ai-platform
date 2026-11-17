//+------------------------------------------------------------------+
//| Self-test: Position Map swings, trend, setups, scorecard and     |
//| trend-life statistics on real XAUUSD W1 / D1 / H4 bars.          |
//| Dumps MQL5\Files\PM_selftest.csv (the bars it used and every     |
//| result) for an independent Python check of the whole chain.      |
//+------------------------------------------------------------------+
#property script_show_inputs
#include "AT24_PM_Core.mqh"

void LoadTf(const ENUM_TIMEFRAMES tf, const int want, MqlRates &r[], int &n)
  {
   n = CopyRates("XAUUSD", tf, 1, want, r);
  }

void OnStart()
  {
   MqlRates rw[], rd[], rh[]; int nW, nD, nH;
   LoadTf(PERIOD_W1, 900, rw, nW); LoadTf(PERIOD_D1, 4000, rd, nD); LoadTf(PERIOD_H4, 9000, rh, nH);
   if(nW < 200 || nD < 1000 || nH < 3000) { PrintFormat("PMTEST FAIL bars W1=%d D1=%d H4=%d", nW, nD, nH); return; }
   // keep only what the H4 history can use: W1 and D1 may be longer, that only adds history
   datetime tW[], tD[], tH[]; double oW[], hW[], lW[], cW[], oD[], hD[], lD[], cD[], oH[], hH[], lH[], cH[];
   ArrayResize(tW, nW); ArrayResize(hW, nW); ArrayResize(lW, nW); ArrayResize(cW, nW); ArrayResize(oW, nW);
   ArrayResize(tD, nD); ArrayResize(hD, nD); ArrayResize(lD, nD); ArrayResize(cD, nD); ArrayResize(oD, nD);
   ArrayResize(tH, nH); ArrayResize(hH, nH); ArrayResize(lH, nH); ArrayResize(cH, nH); ArrayResize(oH, nH);
   for(int i = 0; i < nW; i++) { tW[i] = rw[i].time; oW[i] = rw[i].open; hW[i] = rw[i].high; lW[i] = rw[i].low; cW[i] = rw[i].close; }
   for(int i = 0; i < nD; i++) { tD[i] = rd[i].time; oD[i] = rd[i].open; hD[i] = rd[i].high; lD[i] = rd[i].low; cD[i] = rd[i].close; }
   for(int i = 0; i < nH; i++) { tH[i] = rh[i].time; oH[i] = rh[i].open; hH[i] = rh[i].high; lH[i] = rh[i].low; cH[i] = rh[i].close; }

   AT24PM_Params p;
   p.kW = 2; p.kD = 3; p.kH = 3; p.minSwingAtr = 0.75; p.minRetrace = 0.382; p.stopBufAtr = 0.25; p.rr1 = 3.0; p.rr2 = 4.0; p.rr3 = 5.0;
   p.timeStopWeeks = 8; p.cost = 0.25; p.swapLong = 0.30; p.swapShort = 0.10;

   AT24PM_Plan pl[]; int np = AT24PM_Run(nW, tW, hW, lW, cW, nH, tH, oH, hH, lH, cH, p, pl);
   double atrW[], atrD[], atrH[]; AT24PM_Atr(nW, hW, lW, cW, atrW); AT24PM_Atr(nD, hD, lD, cD, atrD); AT24PM_Atr(nH, hH, lH, cH, atrH);
   AT24PM_Swing sW[], sD[], sH[];
   int cW_ = AT24PM_Swings(nW, hW, lW, cW, atrW, p.kW, p.minSwingAtr, sW);
   int cD_ = AT24PM_Swings(nD, hD, lD, cD, atrD, p.kD, p.minSwingAtr, sD);
   int cH_ = AT24PM_Swings(nH, hH, lH, cH, atrH, p.kH, p.minSwingAtr, sH);

   int f = FileOpen("PM_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", nW, nD, nH, p.kW, p.kD, p.kH, DoubleToString(p.minSwingAtr, 4), DoubleToString(p.minRetrace, 4), DoubleToString(p.stopBufAtr, 4), DoubleToString(p.rr1, 4), DoubleToString(p.rr2, 4), DoubleToString(p.rr3, 4), p.timeStopWeeks, DoubleToString(p.cost, 4), DoubleToString(p.swapLong, 4), DoubleToString(p.swapShort, 4));
   for(int i = 0; i < nW; i++) FileWrite(f, "wbar", (long)tW[i], DoubleToString(oW[i], 3), DoubleToString(hW[i], 3), DoubleToString(lW[i], 3), DoubleToString(cW[i], 3));
   for(int i = 0; i < nD; i++) FileWrite(f, "dbar", (long)tD[i], DoubleToString(oD[i], 3), DoubleToString(hD[i], 3), DoubleToString(lD[i], 3), DoubleToString(cD[i], 3));
   for(int i = 0; i < nH; i++) FileWrite(f, "hbar", (long)tH[i], DoubleToString(oH[i], 3), DoubleToString(hH[i], 3), DoubleToString(lH[i], 3), DoubleToString(cH[i], 3));
   for(int s = 0; s < cW_; s++) FileWrite(f, "swing", "W", sW[s].bar, sW[s].conf, sW[s].type, DoubleToString(sW[s].price, 3), sW[s].repl == AT24PM_INF ? -1 : sW[s].repl, sW[s].brk);
   for(int s = 0; s < cD_; s++) FileWrite(f, "swing", "D", sD[s].bar, sD[s].conf, sD[s].type, DoubleToString(sD[s].price, 3), sD[s].repl == AT24PM_INF ? -1 : sD[s].repl, sD[s].brk);
   for(int s = 0; s < cH_; s++) FileWrite(f, "swing", "H", sH[s].bar, sH[s].conf, sH[s].type, DoubleToString(sH[s].price, 3), sH[s].repl == AT24PM_INF ? -1 : sH[s].repl, sH[s].brk);
   for(int i = 0; i < nW; i++) FileWrite(f, "trendw", i, AT24PM_Trend(sW, cW_, i));
   for(int i = 0; i < nD; i++) FileWrite(f, "trendd", i, AT24PM_Trend(sD, cD_, i));
   for(int k = 0; k < np; k++)
      FileWrite(f, "plan", pl[k].dir, pl[k].trigIdx, pl[k].entryIdx, DoubleToString(pl[k].entry, 3), DoubleToString(pl[k].sl, 6), DoubleToString(pl[k].risk, 6),
                DoubleToString(pl[k].pullback, 3), DoubleToString(pl[k].brkLevel, 3), pl[k].status,
                DoubleToString(pl[k].tp[0], 6), DoubleToString(pl[k].tp[1], 6), DoubleToString(pl[k].tp[2], 6), pl[k].st[0], pl[k].st[1], pl[k].st[2], pl[k].ex[0], pl[k].ex[1], pl[k].ex[2],
                DoubleToString(pl[k].r[0], 8), DoubleToString(pl[k].r[1], 8), DoubleToString(pl[k].r[2], 8), DoubleToString(pl[k].rc[0], 8), DoubleToString(pl[k].rc[1], 8), DoubleToString(pl[k].rc[2], 8));
   AT24PM_Score sc[3], sk[3];
   for(int q = 0; q < 3; q++)
     {
      AT24PM_ScoreOf(pl, np, 20261117, false, q, sc[q]); AT24PM_ScoreOf(pl, np, 20261117, true, q, sk[q]);
      FileWrite(f, "score", q, 0, sc[q].n, sc[q].wins, DoubleToString(sc[q].hitPct, 6), DoubleToString(sc[q].avgR, 8), DoubleToString(sc[q].sumR, 6), DoubleToString(sc[q].t, 8), DoubleToString(sc[q].pFlip, 8), sc[q].open, sc[q].rejected);
      FileWrite(f, "score", q, 1, sk[q].n, sk[q].wins, DoubleToString(sk[q].hitPct, 6), DoubleToString(sk[q].avgR, 8), DoubleToString(sk[q].sumR, 6), DoubleToString(sk[q].t, 8), DoubleToString(sk[q].pFlip, 8), sk[q].open, sk[q].rejected);
     }
   AT24PM_Life L; AT24PM_LifeOf(sW, cW_, tW, atrW, L);
   FileWrite(f, "life", L.nUp, L.nDown, DoubleToString(L.medWeeksUp, 6), DoubleToString(L.medWeeksDown, 6), L.pbUpN, L.pbDownN, DoubleToString(L.pbUpMedPct, 6), DoubleToString(L.pbDownMedPct, 6),
             DoubleToString(L.pbUpMedAtr, 6), DoubleToString(L.pbDownMedAtr, 6), DoubleToString(L.pbUpOver382, 6), DoubleToString(L.pbDownOver382, 6), DoubleToString(L.pbUpOver618, 6), DoubleToString(L.pbDownOver618, 6),
             DoubleToString(L.pbUpBroke, 6), DoubleToString(L.pbDownBroke, 6));
   FileClose(f);
   PrintFormat("PMTEST bars W1=%d D1=%d H4=%d swings W=%d D=%d H=%d setups=%d | 1:3 n=%d hit=%.1f%% avgR=%+.3f p=%.3f ctl=%+.3f | 1:4 n=%d hit=%.1f%% avgR=%+.3f | 1:5 n=%d hit=%.1f%% avgR=%+.3f",
               nW, nD, nH, cW_, cD_, cH_, np, sc[0].n, sc[0].hitPct, sc[0].avgR, sc[0].pFlip, sk[0].avgR, sc[1].n, sc[1].hitPct, sc[1].avgR, sc[2].n, sc[2].hitPct, sc[2].avgR);
   Print("PMTEST done");
  }
