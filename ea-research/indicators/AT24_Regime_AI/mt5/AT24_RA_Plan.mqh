//+------------------------------------------------------------------+
//| AT24_RA_Plan.mqh - tight plan: the Position Map triggers with    |
//| the stop beyond the H4 turn instead of the weekly pullback       |
//| extreme (SPEC section 8). Pure function, chronological arrays.   |
//+------------------------------------------------------------------+
#ifndef AT24_RA_PLAN_MQH
#define AT24_RA_PLAN_MQH

#include "AT24_PM_Core.mqh"

//--- out[k] = pl[k] with stop = H4 turn -/+ stopBufAtr * ATR(14) of H4 at the trigger bar, target 1 = entry +/- rr1 * risk, walked forward (target 1 only).
//--- Targets 2 and 3 and the control are not computed (they copy target 1 / zero). turnPx / turnBar: the H4 swing used for the stop (0 / -1 when none).
void AT24RA_TightPlans(const int np, const AT24PM_Plan &pl[], const int nW, const datetime &tW[], const AT24PM_Swing &sW[], const int cW_,
                       const int nH, const datetime &tH[], const double &hH[], const double &lH[], const double &cH[], const AT24PM_Swing &sH[], const int cH_,
                       const double &aH[], const AT24PM_Params &p, AT24PM_Plan &out[], double &turnPx[], int &turnBar[])
  {
   ArrayResize(out, np); ArrayResize(turnPx, np); ArrayResize(turnBar, np);
   for(int k = 0; k < np; k++)
     {
      out[k] = pl[k]; turnPx[k] = 0.0; turnBar[k] = -1;
      if(pl[k].status == -4) continue;
      AT24PM_Ctx x;
      int stg = AT24PM_Eval(pl[k].trigIdx, nW, tW, sW, cW_, nH, tH, hH, lH, cH, sH, cH_, p, x);
      if(stg != 4 || x.sAbar < 0) { out[k].status = -4; continue; }
      turnPx[k] = x.turnPx; turnBar[k] = x.sAbar;
      int dir = pl[k].dir;
      double buf = p.stopBufAtr * aH[pl[k].trigIdx];
      double sl = (dir > 0) ? x.turnPx - buf : x.turnPx + buf;
      double risk = dir * (pl[k].entry - sl);
      out[k].sl = sl; out[k].risk = risk;
      if(risk <= 0.0) { out[k].status = -4; continue; }
      for(int q = 0; q < 3; q++) { double rr = (q == 0) ? p.rr1 : (q == 1 ? p.rr2 : p.rr3); out[k].tp[q] = pl[k].entry + dir * rr * risk; }
      if(pl[k].status == 3 || pl[k].entryIdx < 0)
        {
         out[k].status = 3;
         for(int q = 0; q < 3; q++) { out[k].st[q] = 2; out[k].ex[q] = -1; out[k].r[q] = 0.0; out[k].rc[q] = 0.0; }
         continue;
        }
      double swp = (dir > 0) ? p.swapLong : p.swapShort;
      int st, ex; double r;
      AT24PM_Walk(dir, pl[k].entry, sl, out[k].tp[0], pl[k].entryIdx, nH, tH, hH, lH, cH, p.timeStopWeeks, p.cost, swp, st, ex, r);
      for(int q = 0; q < 3; q++) { out[k].st[q] = st; out[k].ex[q] = ex; out[k].r[q] = r; out[k].rc[q] = 0.0; }
      out[k].status = 1;
     }
  }

#endif
