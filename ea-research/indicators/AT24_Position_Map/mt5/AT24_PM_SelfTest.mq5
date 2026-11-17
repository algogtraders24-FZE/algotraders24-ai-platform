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
   p.kW = 2; p.kD = 3; p.kH = 3; p.minSwingAtr = 0.75; p.minRetrace = 0.382; p.stopBufAtr = 0.25; p.minRR = 2.0;
   p.timeStopWeeks = 8; p.cost = 0.25; p.swapLong = 0.30; p.swapShort = 0.10;

   AT24PM_Plan pl[]; int np = AT24PM_Run(nW, tW, hW, lW, cW, nH, tH, oH, hH, lH, cH, p, pl);
   double atrW[], atrD[], atrH[]; AT24PM_Atr(nW, hW, lW, cW, atrW); AT24PM_Atr(nD, hD, lD, cD, atrD); AT24PM_Atr(nH, hH, lH, cH, atrH);
   AT24PM_Swing sW[], sD[], sH[];
   int cW_ = AT24PM_Swings(nW, hW, lW, cW, atrW, p.kW, p.minSwingAtr, sW);
   int cD_ = AT24PM_Swings(nD, hD, lD, cD, atrD, p.kD, p.minSwingAtr, sD);
   int cH_ = AT24PM_Swings(nH, hH, lH, cH, atrH, p.kH, p.minSwingAtr, sH);

   int f = FileOpen("PM_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", nW, nD, nH, p.kW, p.kD, p.kH, DoubleToString(p.minSwingAtr, 4), DoubleToString(p.minRetrace, 4), DoubleToString(p.stopBufAtr, 4), DoubleToString(p.minRR, 4), p.timeStopWeeks, DoubleToString(p.cost, 4), DoubleToString(p.swapLong, 4), DoubleToString(p.swapShort, 4));
   for(int i = 0; i < nW; i++) FileWrite(f, "wbar", (long)tW[i], DoubleToString(oW[i], 3), DoubleToString(hW[i], 3), DoubleToString(lW[i], 3), DoubleToString(cW[i], 3));
   for(int i = 0; i < nD; i++) FileWrite(f, "dbar", (long)tD[i], DoubleToString(oD[i], 3), DoubleToString(hD[i], 3), DoubleToString(lD[i], 3), DoubleToString(cD[i], 3));
   for(int i = 0; i < nH; i++) FileWrite(f, "hbar", (long)tH[i], DoubleToString(oH[i], 3), DoubleToString(hH[i], 3), DoubleToString(lH[i], 3), DoubleToString(cH[i], 3));
   for(int s = 0; s < cW_; s++) FileWrite(f, "swing", "W", sW[s].bar, sW[s].conf, sW[s].type, DoubleToString(sW[s].price, 3), sW[s].repl == AT24PM_INF ? -1 : sW[s].repl, sW[s].brk);
   for(int s = 0; s < cD_; s++) FileWrite(f, "swing", "D", sD[s].bar, sD[s].conf, sD[s].type, DoubleToString(sD[s].price, 3), sD[s].repl == AT24PM_INF ? -1 : sD[s].repl, sD[s].brk);
   for(int s = 0; s < cH_; s++) FileWrite(f, "swing", "H", sH[s].bar, sH[s].conf, sH[s].type, DoubleToString(sH[s].price, 3), sH[s].repl == AT24PM_INF ? -1 : sH[s].repl, sH[s].brk);
   for(int i = 0; i < nW; i++) FileWrite(f, "trendw", i, AT24PM_Trend(sW, cW_, i));
   for(int i = 0; i < nD; i++) FileWrite(f, "trendd", i, AT24PM_Trend(sD, cD_, i));
   for(int k = 0; k < np; k++)
      FileWrite(f, "plan", pl[k].dir, pl[k].trigIdx, pl[k].entryIdx, DoubleToString(pl[k].entry, 3), DoubleToString(pl[k].sl, 6), DoubleToString(pl[k].tp, 3), DoubleToString(pl[k].risk, 6), DoubleToString(pl[k].rr, 6),
                DoubleToString(pl[k].pullback, 3), DoubleToString(pl[k].brkLevel, 3), pl[k].status, pl[k].exitIdx, DoubleToString(pl[k].r, 8), DoubleToString(pl[k].rCtl, 8));
   AT24PM_Score sc, sk; AT24PM_ScoreOf(pl, np, 20261117, false, sc); AT24PM_ScoreOf(pl, np, 20261117, true, sk);
   FileWrite(f, "score", 0, sc.n, sc.wins, DoubleToString(sc.hitPct, 6), DoubleToString(sc.avgR, 8), DoubleToString(sc.sumR, 6), DoubleToString(sc.t, 8), DoubleToString(sc.pFlip, 8), sc.open, sc.rejected);
   FileWrite(f, "score", 1, sk.n, sk.wins, DoubleToString(sk.hitPct, 6), DoubleToString(sk.avgR, 8), DoubleToString(sk.sumR, 6), DoubleToString(sk.t, 8), DoubleToString(sk.pFlip, 8), sk.open, sk.rejected);
   AT24PM_Life L; AT24PM_LifeOf(sW, cW_, tW, atrW, L);
   FileWrite(f, "life", L.nUp, L.nDown, DoubleToString(L.medWeeksUp, 6), DoubleToString(L.medWeeksDown, 6), L.pbUpN, L.pbDownN, DoubleToString(L.pbUpMedPct, 6), DoubleToString(L.pbDownMedPct, 6),
             DoubleToString(L.pbUpMedAtr, 6), DoubleToString(L.pbDownMedAtr, 6), DoubleToString(L.pbUpOver382, 6), DoubleToString(L.pbDownOver382, 6), DoubleToString(L.pbUpOver618, 6), DoubleToString(L.pbDownOver618, 6),
             DoubleToString(L.pbUpBroke, 6), DoubleToString(L.pbDownBroke, 6));
   FileClose(f);
   PrintFormat("PMTEST bars W1=%d D1=%d H4=%d swings W=%d D=%d H=%d plans=%d accepted+resolved=%d rejected=%d open=%d hit=%.1f%% avgR=%+.3f p=%.3f control avgR=%+.3f",
               nW, nD, nH, cW_, cD_, cH_, np, sc.n, sc.rejected, sc.open, sc.hitPct, sc.avgR, sc.pFlip, sk.avgR);
   Print("PMTEST done");
  }
