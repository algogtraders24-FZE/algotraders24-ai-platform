//+------------------------------------------------------------------+
//| AT24_DR_Core.mqh                                                 |
//| Daily risk snapshot: loss used against YOUR daily limit, risk of |
//| open positions (to their stop losses), and which of YOUR rules   |
//| are broken right now. Pure maths, no platform calls.             |
//+------------------------------------------------------------------+
#ifndef AT24_DR_CORE_MQH
#define AT24_DR_CORE_MQH

//--- money lost if the stop is hit (0 when there is no stop)
double AT24DR_PosRisk(const double volume, const double entry, const double sl, const int dir, const double tickSize, const double tickValue)
  {
   if(sl <= 0.0 || tickSize <= 0.0 || tickValue <= 0.0 || volume <= 0.0) return 0.0;
   double dist = (dir > 0) ? entry - sl : sl - entry;      // dir +1 long, -1 short
   if(dist <= 0.0) return 0.0;                              // stop already at or beyond break-even: no loss risk left
   return dist / tickSize * tickValue * volume;
  }

//--- out[0] daily loss used % of the limit (0 when the day is not losing), [1] day result (closed + floating),
//--- [2] open risk money, [3] open risk % of day-start balance, [4] positions without a stop,
//--- [5] positions whose own risk exceeds the per-trade limit, [6] trades-per-day rule broken (1/0),
//--- [7] total open risk rule broken (1/0), [8] daily loss limit reached (1/0), [9] rule breaks right now (sum of 4..8 counted)
void AT24DR_Snapshot(const int n, const double &vol[], const double &entry[], const double &sl[], const int &dir[], const double &ts[], const double &tv[],
                     const double dayStartBalance, const double closedPnl, const double floating, const int tradesToday,
                     const double dailyLossPct, const double maxTradePct, const double maxOpenPct, const int maxTrades,
                     double &riskOut[], double &out[])
  {
   ArrayResize(riskOut, n); ArrayResize(out, 10);
   for(int z = 0; z < 10; z++) out[z] = 0.0;
   double open = 0.0; int noSl = 0, over = 0;
   for(int i = 0; i < n; i++)
     {
      riskOut[i] = AT24DR_PosRisk(vol[i], entry[i], sl[i], dir[i], ts[i], tv[i]);
      open += riskOut[i];
      if(sl[i] <= 0.0) noSl++;
      else if(dayStartBalance > 0.0 && 100.0 * riskOut[i] / dayStartBalance > maxTradePct + 1e-9) over++;
     }
   double res = closedPnl + floating;
   double limit = dayStartBalance * dailyLossPct / 100.0;
   out[0] = (limit > 0.0 && res < 0.0) ? 100.0 * (-res) / limit : 0.0;
   out[1] = res; out[2] = open;
   out[3] = (dayStartBalance > 0.0) ? 100.0 * open / dayStartBalance : 0.0;
   out[4] = noSl; out[5] = over;
   out[6] = (maxTrades > 0 && tradesToday > maxTrades) ? 1.0 : 0.0;
   out[7] = (dayStartBalance > 0.0 && out[3] > maxOpenPct + 1e-9) ? 1.0 : 0.0;
   out[8] = (out[0] >= 100.0) ? 1.0 : 0.0;
   out[9] = noSl + over + out[6] + out[7] + out[8];
  }

#endif // AT24_DR_CORE_MQH
