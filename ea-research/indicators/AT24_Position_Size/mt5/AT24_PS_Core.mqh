//+------------------------------------------------------------------+
//| AT24_PS_Core.mqh                                                 |
//| Position size from risk money and stop distance.                 |
//| lots = risk / (stop distance / tick size * tick value), rounded  |
//| DOWN to the volume step and clamped to the symbol's limits.      |
//| Pure maths, no platform calls.                                   |
//+------------------------------------------------------------------+
#ifndef AT24_PS_CORE_MQH
#define AT24_PS_CORE_MQH

struct AT24PS_Result
  {
   double lossPerLot;   // account-currency loss of one lot if the stop is hit
   double rawLots;      // before rounding
   double lots;         // rounded down to the step, within [min, max]; 0 if even the minimum lot risks more than allowed
   double riskAtLots;   // account-currency loss at `lots`
   bool   tooSmall;     // minimum lot would risk more than the money available
   bool   capped;       // limited by the maximum volume
  };

double AT24PS_LossPerLot(const double slDistance, const double tickSize, const double tickValue)
  {
   if(tickSize <= 0.0 || tickValue <= 0.0 || slDistance <= 0.0) return 0.0;
   return slDistance / tickSize * tickValue;
  }

void AT24PS_Size(const double riskMoney, const double slDistance, const double tickSize, const double tickValue,
                 const double volMin, const double volMax, const double volStep, AT24PS_Result &r)
  {
   r.lossPerLot = AT24PS_LossPerLot(slDistance, tickSize, tickValue);
   r.rawLots = 0.0; r.lots = 0.0; r.riskAtLots = 0.0; r.tooSmall = false; r.capped = false;
   if(r.lossPerLot <= 0.0 || riskMoney <= 0.0 || volStep <= 0.0) return;
   r.rawLots = riskMoney / r.lossPerLot;
   //--- a tiny epsilon keeps exact multiples (e.g. 0.30 lots) from falling one step down through binary rounding
   double steps = MathFloor(r.rawLots / volStep + 1e-9);
   double lots = steps * volStep;
   if(lots < volMin - 1e-12) { r.tooSmall = true; return; }
   if(lots > volMax) { lots = MathFloor(volMax / volStep + 1e-9) * volStep; r.capped = true; }
   r.lots = lots;
   r.riskAtLots = lots * r.lossPerLot;
  }

//--- Wilder ATR of closed bars (first value = mean of the first len true ranges); returns the last value
double AT24PS_Atr(const int n, const double &high[], const double &low[], const double &close[], const int len)
  {
   if(n <= len) return 0.0;
   double atr = 0.0, sum = 0.0;
   for(int i = 0; i < n; i++)
     {
      double tr = (i == 0) ? high[0] - low[0] : MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
      if(i < len) { sum += tr; if(i == len - 1) atr = sum / len; }
      else atr = (atr * (len - 1) + tr) / len;
     }
   return atr;
  }

#endif // AT24_PS_CORE_MQH
