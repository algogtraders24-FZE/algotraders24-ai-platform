//+------------------------------------------------------------------+
//| AT24_RA_PlanDump - dumps the H4 bars and every tight plan of the |
//| Regime AI (stop beyond the H4 turn) for the independent check.   |
//+------------------------------------------------------------------+
#include "AT24_RA_Plan.mqh"

void Dump(const string sym, const double cost)
  {
   MqlRates rw[], rh[]; int nW = -1, nH = -1;
   for(int t = 0; t < 20 && (nW < 60 || nH < 600); t++) { nW = CopyRates(sym, PERIOD_W1, 1, 400, rw); nH = CopyRates(sym, PERIOD_H4, 1, 4500, rh); if(nW < 60 || nH < 600) Sleep(500); }
   if(nW < 60 || nH < 600) { Print("RA plan dump: no data for ", sym); return; }
   datetime tW[], tH[]; double hW[], lW[], cW[], oH[], hH[], lH[], cH[], aW[], aH[];
   ArrayResize(tW, nW); ArrayResize(hW, nW); ArrayResize(lW, nW); ArrayResize(cW, nW);
   ArrayResize(tH, nH); ArrayResize(oH, nH); ArrayResize(hH, nH); ArrayResize(lH, nH); ArrayResize(cH, nH);
   for(int i = 0; i < nW; i++) { tW[i] = rw[i].time; hW[i] = rw[i].high; lW[i] = rw[i].low; cW[i] = rw[i].close; }
   for(int i = 0; i < nH; i++) { tH[i] = rh[i].time; oH[i] = rh[i].open; hH[i] = rh[i].high; lH[i] = rh[i].low; cH[i] = rh[i].close; }
   AT24PM_Params p;
   p.kW = 2; p.kD = 3; p.kH = 3; p.minSwingAtr = 0.75; p.minRetrace = 0.382; p.stopBufAtr = 0.25; p.rr1 = 3.0; p.rr2 = 4.0; p.rr3 = 5.0; p.timeStopWeeks = 8; p.cost = cost; p.swapLong = 0.0; p.swapShort = 0.0;
   AT24PM_Atr(nW, hW, lW, cW, aW); AT24PM_Atr(nH, hH, lH, cH, aH);
   AT24PM_Swing sW[], sH[];
   int cW_ = AT24PM_Swings(nW, hW, lW, cW, aW, p.kW, p.minSwingAtr, sW);
   int cH_ = AT24PM_Swings(nH, hH, lH, cH, aH, p.kH, p.minSwingAtr, sH);
   AT24PM_Plan pl[]; int np = AT24PM_Run(nW, tW, hW, lW, cW, nH, tH, oH, hH, lH, cH, p, pl);
   AT24PM_Plan tp[]; double tpx[]; int tbr[];
   AT24RA_TightPlans(np, pl, nW, tW, sW, cW_, nH, tH, hH, lH, cH, sH, cH_, aH, p, tp, tpx, tbr);
   int f = FileOpen("RAP_h4_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "i", "t", "open", "high", "low", "close");
   for(int i = 0; i < nH; i++) FileWrite(f, i, (long)tH[i], DoubleToString(oH[i], 8), DoubleToString(hH[i], 8), DoubleToString(lH[i], 8), DoubleToString(cH[i], 8));
   FileClose(f);
   f = FileOpen("RAP_plans_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "k", "dir", "trig", "entryIdx", "entry", "structSL", "status", "turnBar", "turnPx", "tightSL", "risk", "tp1", "tstatus", "st", "ex", "r", "cost");
   for(int k = 0; k < np; k++)
      FileWrite(f, k, pl[k].dir, pl[k].trigIdx, pl[k].entryIdx, DoubleToString(pl[k].entry, 8), DoubleToString(pl[k].sl, 8), pl[k].status, tbr[k], DoubleToString(tpx[k], 8),
                DoubleToString(tp[k].sl, 8), DoubleToString(tp[k].risk, 8), DoubleToString(tp[k].tp[0], 8), tp[k].status, tp[k].st[0], tp[k].ex[0], DoubleToString(tp[k].r[0], 10), DoubleToString(cost, 8));
   FileClose(f);
   int ntight = 0, nstruct = 0;
   for(int k = 0; k < np; k++) { if(tp[k].status == 1 && tp[k].st[0] != 2) ntight++; if(pl[k].status == 1 && pl[k].st[0] != 2) nstruct++; }
   PrintFormat("RA plan dump %s: %d plans, resolved tight %d, resolved weekly-stop %d", sym, np, ntight, nstruct);
  }

void OnStart()
  {
   Dump("XAUUSD", 0.30); Dump("EURUSD", 0.00012); Dump("GBPUSD", 0.00015); Dump("USDJPY", 0.012); Dump("USDCHF", 0.00015);
  }
