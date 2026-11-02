//+------------------------------------------------------------------+
//| AT24_RegimePulse_Core.mqh                                        |
//| Pure maths shared by the AT24 Regime Pulse indicator and its     |
//| self-test script. All arrays are chronological (index 0 = oldest)|
//| Outputs per bar i:                                               |
//|   atr[i]  Wilder ATR(atrPeriod)                                  |
//|   er[i]   Kaufman Efficiency Ratio(erPeriod), 0..1               |
//|   pct[i]  percentile rank of atr[i] in its last `lookback` bars, |
//|           0..100 (share of values <= current)                    |
//+------------------------------------------------------------------+
#ifndef AT24_REGIMEPULSE_CORE_MQH
#define AT24_REGIMEPULSE_CORE_MQH

enum ENUM_AT24RP_REGIME
  {
   RP_NONE = 0,     // not enough data
   RP_TREND = 1,    // efficient move, normal/low volatility
   RP_STRONG = 2,   // efficient move AND high volatility (strongest trend conditions)
   RP_RANGE = 3,    // inefficient (back and forth), normal volatility
   RP_CHOP = 4,     // inefficient AND high volatility (hardest to trade)
   RP_QUIET = 5,    // very low volatility rank
   RP_MIXED = 6     // in between
  };

string AT24RP_RegimeName(const int r)
  {
   switch(r)
     {
      case RP_TREND:  return "TREND";
      case RP_STRONG: return "STRONG TREND";
      case RP_RANGE:  return "RANGE";
      case RP_CHOP:   return "CHOP (volatile range)";
      case RP_QUIET:  return "QUIET";
      case RP_MIXED:  return "MIXED";
     }
   return "...";
  }

//--- Regime from the two measurements. erTrend > erRange; pctHigh > pctQuiet.
int AT24RP_Classify(const double er, const double pct, const double erTrend, const double erRange,
                    const double pctHigh, const double pctQuiet)
  {
   if(er < 0.0 || pct < 0.0) return RP_NONE;
   if(pct <= pctQuiet) return RP_QUIET;
   if(er >= erTrend) return (pct >= pctHigh) ? RP_STRONG : RP_TREND;
   if(er <= erRange) return (pct >= pctHigh) ? RP_CHOP : RP_RANGE;
   return RP_MIXED;
  }

//--- Session label for a GMT hour (gold/FX oriented)
string AT24RP_Session(const int gmtHour, const int gmtMin)
  {
   int m = gmtHour * 60 + gmtMin;
   if(m >= 21 * 60 + 30 && m < 23 * 60 + 30) return "ROLLOVER (wide spread)";
   if(m >= 13 * 60 && m < 16 * 60) return "LONDON/NY OVERLAP";
   if(m >= 7 * 60 && m < 13 * 60)  return "LONDON";
   if(m >= 16 * 60 && m < 21 * 60 + 30) return "NEW YORK";
   return "ASIA";
  }

//--- Main calculation. `first` = first bar index to (re)compute; `base` = first bar of the data window (bars before it are ignored).
//--- Returns true when outputs are valid for `total` bars.
bool AT24RP_Calc(const int total, const int first, const int base, const double &high[], const double &low[], const double &close[],
                 const int erPeriod, const int atrPeriod, const int lookback,
                 double &atr[], double &er[], double &pct[])
  {
   if(total - base < atrPeriod + 2 || erPeriod < 2 || atrPeriod < 2 || lookback < 10) return false;
   int start = MathMax(MathMax(first, base), 0);
   for(int i = start; i < total; i++)
     {
      //--- ATR (Wilder): seed with the simple mean of the first atrPeriod true ranges
      double tr = (i <= base) ? (high[0] - low[0])
                           : MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
      if(i < base + atrPeriod)      atr[i] = EMPTY_VALUE;
      else if(i == base + atrPeriod)
        {
         double s = 0.0;
         for(int ka = base + 1; ka <= base + atrPeriod; ka++)
            s += MathMax(high[ka] - low[ka], MathMax(MathAbs(high[ka] - close[ka - 1]), MathAbs(low[ka] - close[ka - 1])));
         atr[i] = s / atrPeriod;
        }
      else                   atr[i] = (atr[i - 1] * (atrPeriod - 1) + tr) / atrPeriod;

      //--- Efficiency ratio
      if(i < base + erPeriod) er[i] = EMPTY_VALUE;
      else
        {
         double path = 0.0;
         for(int ke = i - erPeriod + 1; ke <= i; ke++) path += MathAbs(close[ke] - close[ke - 1]);
         er[i] = (path > 0.0) ? MathAbs(close[i] - close[i - erPeriod]) / path : 0.0;
        }

      //--- ATR percentile rank over the last `lookback` valid ATR values
      if(atr[i] == EMPTY_VALUE) { pct[i] = EMPTY_VALUE; continue; }
      int from = MathMax(base + atrPeriod, i - lookback + 1);
      int cnt = 0, le = 0;
      for(int kp = from; kp <= i; kp++) { cnt++; if(atr[kp] <= atr[i]) le++; }
      pct[i] = (cnt >= 20) ? 100.0 * le / cnt : EMPTY_VALUE;
     }
   return true;
  }

#endif // AT24_REGIMEPULSE_CORE_MQH
