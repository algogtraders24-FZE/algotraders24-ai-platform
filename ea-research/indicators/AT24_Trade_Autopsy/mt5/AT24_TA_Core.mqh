//+------------------------------------------------------------------+
//| AT24_TA_Core.mqh                                                 |
//| Trade autopsy: for each closed trade, how far did price go in    |
//| your favour (MFE), against you (MAE), how much of the best price |
//| did the exit capture, and what did price do right after the exit.|
//| Pure maths on a bar series (time, high, low). Descriptive.       |
//+------------------------------------------------------------------+
#ifndef AT24_TA_CORE_MQH
#define AT24_TA_CORE_MQH

struct AT24TA_Trade
  {
   int      dir;       // +1 long, -1 short
   datetime tIn;
   datetime tOut;
   double   pIn;
   double   pOut;
   double   sl;        // stop-loss price at entry, 0 if none
   double   profit;    // net result in account currency (not used by the maths, only displayed)
  };

struct AT24TA_Res
  {
   bool   ok;
   double move;        // price move in your favour (negative = loss), price units
   double mfe;         // best favourable excursion during the trade, price units (>= 0)
   double mae;         // worst adverse excursion during the trade, price units (>= 0)
   double post;        // best favourable move (from the ENTRY price) in the bars right after the exit, price units (can be < 0)
   double r;           // move / initial risk, 0 when no stop was set
  };

struct AT24TA_Sum
  {
   int    n;           // trades analysed
   int    winners;
   int    losers;
   double captureWin;  // mean of move / MFE over winners (0..1)
   double giveBackPct; // % of trades with MFE > 0 that closed with less than half of their best price
   double earlyPct;    // % of winners where price went at least as far again in the next bars (post - move >= move)
   double recoverPct;  // % of losers where price got back to the entry price within the next bars (post >= 0)
   double avgMaePct;   // mean MAE of winners as % of their MFE (how much heat winners took)
   double avgR;        // mean R over trades with a stop (0 if none)
   int    withStop;
  };

//--- bars overlapping the trade: from the bar that contains tIn to the bar that contains tOut; post window = the next `postBars` bars after that
void AT24TA_One(const AT24TA_Trade &t, const int n, const datetime &time[], const double &high[], const double &low[], const int period, const int postBars, AT24TA_Res &r)
  {
   r.ok = false; r.move = 0.0; r.mfe = 0.0; r.mae = 0.0; r.post = 0.0; r.r = 0.0;
   if(n < 2 || t.dir == 0 || t.tOut < t.tIn) return;
   long s0 = ((long)t.tIn / period) * period, s1 = ((long)t.tOut / period) * period;
   int i0 = -1, i1 = -1;
   for(int i = 0; i < n; i++)
     {
      if(i0 < 0 && (long)time[i] >= s0) i0 = i;
      if((long)time[i] <= s1) i1 = i;
     }
   if(i0 < 0 || i1 < i0) return;
   double fav = 0.0, adv = 0.0;
   for(int i = i0; i <= i1; i++)
     {
      double f = (t.dir > 0) ? high[i] - t.pIn : t.pIn - low[i];
      double a = (t.dir > 0) ? t.pIn - low[i] : high[i] - t.pIn;
      if(f > fav) fav = f;
      if(a > adv) adv = a;
     }
   r.move = t.dir * (t.pOut - t.pIn);
   r.mfe = MathMax(fav, MathMax(r.move, 0.0));       // the exit price itself is part of the path
   r.mae = MathMax(adv, MathMax(-r.move, 0.0));
   int e = MathMin(n - 1, i1 + postBars);
   double best = -1e300;
   if(i1 + 1 <= e)
     {
      for(int i = i1 + 1; i <= e; i++)
        {
         double f = (t.dir > 0) ? high[i] - t.pIn : t.pIn - low[i];
         if(f > best) best = f;
        }
      r.post = best;
     }
   else r.post = r.move;
   if(t.sl > 0.0) { double risk = MathAbs(t.pIn - t.sl); if(risk > 0.0) r.r = r.move / risk; }
   r.ok = true;
  }

void AT24TA_Analyze(const AT24TA_Trade &tr[], const int m, const int n, const datetime &time[], const double &high[], const double &low[], const int period, const int postBars, AT24TA_Sum &s)
  {
   s.n = 0; s.winners = 0; s.losers = 0; s.captureWin = 0.0; s.giveBackPct = 0.0; s.earlyPct = 0.0; s.recoverPct = 0.0; s.avgMaePct = 0.0; s.avgR = 0.0; s.withStop = 0;
   double capSum = 0.0, maeSum = 0.0, rSum = 0.0; int gbDen = 0, gb = 0, early = 0, rec = 0, maeN = 0;
   for(int k = 0; k < m; k++)
     {
      AT24TA_Res r; AT24TA_One(tr[k], n, time, high, low, period, postBars, r);
      if(!r.ok) continue;
      s.n++;
      if(tr[k].sl > 0.0 && r.r != 0.0) { s.withStop++; rSum += r.r; }
      if(r.mfe > 0.0) { gbDen++; if(r.move < 0.5 * r.mfe) gb++; }
      if(r.move > 0.0)
        {
         s.winners++;
         if(r.mfe > 0.0) capSum += r.move / r.mfe;
         if(r.post - r.move >= r.move) early++;
         if(r.mfe > 0.0) { maeSum += r.mae / r.mfe; maeN++; }
        }
      else if(r.move < 0.0)
        {
         s.losers++;
         if(r.post >= 0.0) rec++;
        }
     }
   if(s.winners > 0) { s.captureWin = capSum / s.winners; s.earlyPct = 100.0 * early / s.winners; }
   if(maeN > 0) s.avgMaePct = 100.0 * maeSum / maeN;
   if(gbDen > 0) s.giveBackPct = 100.0 * gb / gbDen;
   if(s.losers > 0) s.recoverPct = 100.0 * rec / s.losers;
   if(s.withStop > 0) s.avgR = rSum / s.withStop;
  }

#endif // AT24_TA_CORE_MQH
