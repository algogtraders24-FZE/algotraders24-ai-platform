//+------------------------------------------------------------------+
//| AT24_G01_Liquidity.mqh                                             |
//| PURE, PLATFORM-AGNOSTIC. PDH/PDL, PWH/PWL, and Equal High/Low      |
//| liquidity level assembly. Operates only on plain SBar / SSwingPoint|
//| inputs supplied by the caller (fetched via Utils.mqh adapter) --   |
//| no direct platform API calls, so this file is unchanged by an MT4 |
//| port.                                                                |
//+------------------------------------------------------------------+
#ifndef AT24_G01_LIQUIDITY_MQH
#define AT24_G01_LIQUIDITY_MQH

#include "AT24_G01_Types.mqh"

void G01_PushLevel(SLiquidityLevel &levels[],ENUM_G01_LIQUIDITY_TYPE type,double price,datetime t)
  {
   int n = ArraySize(levels);
   ArrayResize(levels,n+1);
   levels[n].type           = type;
   levels[n].price          = price;
   levels[n].reference_time = t;
   levels[n].valid          = true;
  }

//--- Equal High: >=2 confirmed swing highs clustered within an ATR-relative tolerance.
//--- Level price = the highest price in the cluster (the actual resting liquidity above).
bool G01_DetectEqualHigh(const SSwingPoint &highs[],double tolerance,double &level,datetime &t)
  {
   int n = ArraySize(highs);
   for(int i=n-1; i>=1; i--)
     {
      for(int j=i-1; j>=0; j--)
        {
         if(MathAbs(highs[i].price - highs[j].price) <= tolerance)
           {
            level = MathMax(highs[i].price,highs[j].price);
            t     = highs[i].time;
            return(true);
           }
        }
     }
   return(false);
  }

//--- Equal Low: >=2 confirmed swing lows clustered within an ATR-relative tolerance.
//--- Level price = the lowest price in the cluster (the actual resting liquidity below).
bool G01_DetectEqualLow(const SSwingPoint &lows[],double tolerance,double &level,datetime &t)
  {
   int n = ArraySize(lows);
   for(int i=n-1; i>=1; i--)
     {
      for(int j=i-1; j>=0; j--)
        {
         if(MathAbs(lows[i].price - lows[j].price) <= tolerance)
           {
            level = MathMin(lows[i].price,lows[j].price);
            t     = lows[i].time;
            return(true);
           }
        }
     }
   return(false);
  }

//--- Assemble the full prioritized liquidity level list for one evaluation cycle.
//--- Priority order (index 0 = highest): PDH, PDL, PWH, PWL, EQH, EQL,
//--- most recent confirmed M15 swing high, most recent confirmed M15 swing low.
//--- prevDay/prevWeek must already be the previous COMPLETED D1/W1 bar (adapter's job).
int G01_AssembleLiquidityLevels(const SBar &prevDay,bool havePrevDay,
                                 const SBar &prevWeek,bool havePrevWeek,
                                 const SSwingPoint &m15Highs[],const SSwingPoint &m15Lows[],
                                 double eqTolerance,
                                 SLiquidityLevel &levels[])
  {
   ArrayResize(levels,0);

   if(havePrevDay)
     {
      G01_PushLevel(levels,LIQ_PDH,prevDay.high,prevDay.time);
      G01_PushLevel(levels,LIQ_PDL,prevDay.low,prevDay.time);
     }
   if(havePrevWeek)
     {
      G01_PushLevel(levels,LIQ_PWH,prevWeek.high,prevWeek.time);
      G01_PushLevel(levels,LIQ_PWL,prevWeek.low,prevWeek.time);
     }

   double eqHigh,eqLow; datetime eqHighTime,eqLowTime;
   if(G01_DetectEqualHigh(m15Highs,eqTolerance,eqHigh,eqHighTime))
      G01_PushLevel(levels,LIQ_EQH,eqHigh,eqHighTime);
   if(G01_DetectEqualLow(m15Lows,eqTolerance,eqLow,eqLowTime))
      G01_PushLevel(levels,LIQ_EQL,eqLow,eqLowTime);

   int nH = ArraySize(m15Highs);
   int nL = ArraySize(m15Lows);
   if(nH > 0)
      G01_PushLevel(levels,LIQ_SWING_HIGH_M15,m15Highs[nH-1].price,m15Highs[nH-1].time);
   if(nL > 0)
      G01_PushLevel(levels,LIQ_SWING_LOW_M15,m15Lows[nL-1].price,m15Lows[nL-1].time);

   return(ArraySize(levels));
  }

#endif // AT24_G01_LIQUIDITY_MQH
