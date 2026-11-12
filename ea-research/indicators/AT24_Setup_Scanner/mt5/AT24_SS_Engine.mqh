//+------------------------------------------------------------------+
//| AT24_SS_Engine.mqh                                               |
//| Setup Scanner engine: runs the Setup Pro analysis (pullback and  |
//| squeeze setups, forward simulation, scorecard) for ONE symbol    |
//| and timeframe and returns one table row. The maths is the        |
//| verified Setup Pro core; this file only fetches bars and wires   |
//| the pieces together.                                             |
//+------------------------------------------------------------------+
#ifndef AT24_SS_ENGINE_MQH
#define AT24_SS_ENGINE_MQH

#include "AT24_Pullback_Core.mqh"
#include "AT24_Squeeze_Core.mqh"
#include "AT24_SP_Core.mqh"

struct AT24SS_Row
  {
   string       sym;
   bool         ok;
   int          bars;
   double       cost;
   int          digits;
   AT24SP_Score sc[2];
   int          trend;       // trend state of the last closed bar (+1 / -1 / 0)
   int          active;      // -1 none, else 0 pullback / 1 squeeze (signal on the last closed bar)
   int          actDir;
   double       actEntry, actSl, actTp;
   datetime     lastBar;
  };

//--- keep = true returns the working arrays (for the self-test dump); the scanner passes false and lets them go
class AT24SS_Work
  {
public:
   double o[], h[], l[], c[], at[], at2[];
   int    pi[], pd[], qi[], qd[];
   int    np, nq;
   AT24SP_Setup stP[], stQ[];
   int    cP, cQ;
   double cost;
  };

bool AT24SS_Analyze(const string sym, const ENUM_TIMEFRAMES tf, const int hist, const bool usePull, const bool useSq, const double slMult, const double rr,
                    const int maxHold, const double costIn, AT24SS_Row &row, AT24SS_Work &w)
  {
   row.sym = sym; row.ok = false; row.bars = 0; row.cost = 0.0; row.trend = 0; row.active = -1; row.actDir = 0; row.actEntry = 0.0; row.actSl = 0.0; row.actTp = 0.0; row.lastBar = 0;
   row.digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   for(int k = 0; k < 2; k++) { row.sc[k].n = 0; row.sc[k].wins = 0; row.sc[k].hitPct = 0.0; row.sc[k].avgR = 0.0; row.sc[k].sumR = 0.0; row.sc[k].t = 0.0; row.sc[k].pFlip = 1.0; row.sc[k].open = 0; }
   if(!SymbolSelect(sym, true)) return false;
   MqlRates rr_[];
   int n = CopyRates(sym, tf, 1, MathMax(hist, 1000), rr_);
   if(n < 500) return false;
   ArrayResize(w.o, n); ArrayResize(w.h, n); ArrayResize(w.l, n); ArrayResize(w.c, n);
   for(int i = 0; i < n; i++) { w.o[i] = rr_[i].open; w.h[i] = rr_[i].high; w.l[i] = rr_[i].low; w.c[i] = rr_[i].close; }
   row.lastBar = rr_[n - 1].time; row.bars = n;
   double ef[], em[], es[]; int tr[];
   ArrayResize(ef, n); ArrayResize(em, n); ArrayResize(es, n); ArrayResize(w.at, n); ArrayResize(tr, n);
   AT24TP_Ema(n, w.c, 20, ef); AT24TP_Ema(n, w.c, 50, em); AT24TP_Ema(n, w.c, 200, es); AT24TP_Atr(n, w.h, w.l, w.c, 14, w.at);
   AT24TP_Trend(n, ef, em, es, w.at, 200, 5, 0.10, tr);
   row.trend = tr[n - 1];
   double cost = costIn > 0.0 ? costIn : (SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID));
   if(cost < 0.0) cost = 0.0;
   row.cost = cost; w.cost = cost;
   w.cP = 0; w.cQ = 0; w.np = 0; w.nq = 0; ArrayResize(w.stP, 0); ArrayResize(w.stQ, 0);
   AT24TP_Ev pev[]; int np = 0;
   if(usePull) np = AT24TP_Events(n, w.h, w.l, w.c, ef, em, w.at, tr, 20, 20, pev);
   if(usePull)
     {
      ArrayResize(w.pi, np); ArrayResize(w.pd, np); w.np = np;
      for(int k = 0; k < np; k++) { w.pi[k] = pev[k].idx; w.pd[k] = pev[k].dir; }
      w.cP = AT24SP_Simulate(n, w.o, w.h, w.l, w.c, w.at, w.pi, w.pd, np, 0, slMult, rr, maxHold, cost, w.stP);
      AT24SP_ScoreOf(w.stP, w.cP, 20261111, row.sc[0]);
      for(int k = np - 1; k >= 0; k--) { if(pev[k].idx == n - 1) { row.active = 0; row.actDir = pev[k].dir; } break; }
     }
   AT24SQ_Ev qev[]; int nq = 0; double mid[], mom[], ratio[]; int sq[];
   if(useSq)
     {
      ArrayResize(mid, n); ArrayResize(mom, n); ArrayResize(w.at2, n); ArrayResize(ratio, n); ArrayResize(sq, n);
      AT24SQ_Calc(n, w.h, w.l, w.c, 20, 2.0, 20, 1.5, 14, mid, mom, w.at2, ratio, sq);
      nq = AT24SQ_Events(n, w.h, w.l, w.c, mid, w.at2, sq, 6, 20, qev);
      ArrayResize(w.qi, nq); ArrayResize(w.qd, nq); w.nq = nq;
      for(int k = 0; k < nq; k++) { w.qi[k] = qev[k].idx; w.qd[k] = qev[k].mom; }
      w.cQ = AT24SP_Simulate(n, w.o, w.h, w.l, w.c, w.at2, w.qi, w.qd, nq, 1, slMult, rr, maxHold, cost, w.stQ);
      AT24SP_ScoreOf(w.stQ, w.cQ, 20261111, row.sc[1]);
      if(row.active < 0) for(int k = nq - 1; k >= 0; k--) { if(qev[k].idx == n - 1) { row.active = 1; row.actDir = qev[k].mom; } break; }
     }
   if(row.active >= 0)
     {
      double risk = slMult * w.at[n - 1];
      row.actEntry = w.c[n - 1]; row.actSl = row.actEntry - row.actDir * risk; row.actTp = row.actEntry + row.actDir * rr * risk;
     }
   row.ok = true;
   return true;
  }

#endif // AT24_SS_ENGINE_MQH
