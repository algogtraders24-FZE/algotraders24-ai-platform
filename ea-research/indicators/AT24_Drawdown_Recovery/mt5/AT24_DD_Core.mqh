//+------------------------------------------------------------------+
//| AT24_DD_Core.mqh                                                 |
//| Drawdown and recovery maths.                                     |
//| gain needed to recover a drawdown d (fraction) = d / (1 - d)     |
//| after n losses of r (fraction) each: drawdown = 1 - (1 - r)^n    |
//| Pure maths, chronological arrays.                                |
//+------------------------------------------------------------------+
#ifndef AT24_DD_CORE_MQH
#define AT24_DD_CORE_MQH

//--- % gain needed to get back from a % drawdown (0 <= dd < 100)
double AT24DD_Recovery(const double ddPct)
  {
   double d = ddPct / 100.0;
   if(d <= 0.0) return 0.0;
   if(d >= 1.0) return 1e9;
   return 100.0 * d / (1.0 - d);
  }

//--- drawdown % after n consecutive losses of riskPct % of the CURRENT balance each
double AT24DD_Streak(const double riskPct, const int n)
  {
   if(n <= 0 || riskPct <= 0.0) return 0.0;
   return 100.0 * (1.0 - MathPow(1.0 - riskPct / 100.0, n));
  }

//--- consecutive losses of riskPct % that take the account down by at least ddPct %
int AT24DD_LossesTo(const double riskPct, const double ddPct)
  {
   if(riskPct <= 0.0 || riskPct >= 100.0 || ddPct <= 0.0 || ddPct >= 100.0) return 0;
   int n = 0;
   double bal = 1.0;
   while(n < 100000)
     {
      n++;
      bal *= (1.0 - riskPct / 100.0);
      if((1.0 - bal) * 100.0 >= ddPct - 1e-12) return n;
     }
   return n;
  }

//--- equity curve = base + cumulative pnl[]; floating profit added at the end.
//--- out[0] peak equity, [1] max drawdown % (from the running peak), [2] current drawdown % vs the peak (incl. floating),
//--- [3] % gain needed to reach the peak again, [4] current equity, [5] gain needed to recover the max drawdown,
//--- [6] bars (deals) since the peak, [7] number of deals used
void AT24DD_Analyze(const int n, const double &pnl[], const double base, const double floating, double &out[])
  {
   ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   double eq = base, peak = base, maxdd = 0.0;
   int peakAt = 0;
   for(int i = 0; i < n; i++)
     {
      eq += pnl[i];
      if(eq > peak) { peak = eq; peakAt = i + 1; }
      if(peak > 0.0) { double dd = 100.0 * (peak - eq) / peak; if(dd > maxdd) maxdd = dd; }
     }
   double cur = eq + floating;
   if(cur > peak) { peak = cur; peakAt = n; }
   double cdd = (peak > 0.0) ? 100.0 * (peak - cur) / peak : 0.0;
   if(cdd > maxdd) maxdd = cdd;
   out[0] = peak; out[1] = maxdd; out[2] = cdd; out[3] = AT24DD_Recovery(cdd); out[4] = cur;
   out[5] = AT24DD_Recovery(maxdd); out[6] = n - peakAt; out[7] = n;
  }

#endif // AT24_DD_CORE_MQH
