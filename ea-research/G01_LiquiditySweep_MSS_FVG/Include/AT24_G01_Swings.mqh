//+------------------------------------------------------------------+
//| AT24_G01_Swings.mqh                                                |
//| PURE, PLATFORM-AGNOSTIC. Deterministic, non-repainting confirmed   |
//| swing high/low detection. Operates only on an SBar[] window        |
//| supplied by the caller -- no direct platform API calls.            |
//|                                                                      |
//| Same algorithm/inputs (lookback, an SBar window) is used for both  |
//| the M15 liquidity swings and the M5 MSS-reference swings; the      |
//| caller just picks which timeframe's bars to fetch and which        |
//| SSwingPoint arrays to update.                                      |
//+------------------------------------------------------------------+
#ifndef AT24_G01_SWINGS_MQH
#define AT24_G01_SWINGS_MQH

#include "AT24_G01_Types.mqh"

#define G01_MAX_STORED_SWINGS 50

//--- Append a confirmed swing point, de-duplicating and trimming to G01_MAX_STORED_SWINGS.
void G01_AppendSwing(SSwingPoint &arr[],datetime t,double price,bool isHigh)
  {
   int n = ArraySize(arr);
   if(n > 0 && arr[n-1].time == t && arr[n-1].is_high == isHigh)
      return;
   ArrayResize(arr,n+1);
   arr[n].time    = t;
   arr[n].price   = price;
   arr[n].is_high = isHigh;
   arr[n].valid   = true;
   n = ArraySize(arr);
   if(n > G01_MAX_STORED_SWINGS)
     {
      int drop = n - G01_MAX_STORED_SWINGS;
      for(int i=0; i<G01_MAX_STORED_SWINGS; i++)
         arr[i] = arr[i+drop];
      ArrayResize(arr,G01_MAX_STORED_SWINGS);
     }
  }

//--- Evaluate the single candidate bar in the middle of a (2*lookback+1)-bar CLOSED window.
//--- window[0] must be the most recently CLOSED bar (shift 1), most-recent-first ordering.
//--- The candidate (index 'lookback') is a confirmed swing high/low only if it is a strict
//--- local extreme across the whole window -- i.e. it is confirmed exactly once, the first
//--- time 'lookback' newer closed bars exist on its right, and never re-evaluated afterwards.
//--- This is what makes the algorithm non-repainting.
bool G01_EvaluateSwingWindow(const SBar &window[],int lookback,
                              bool &isSwingHigh,double &highPrice,datetime &highTime,
                              bool &isSwingLow,double &lowPrice,datetime &lowTime)
  {
   int size = 2*lookback + 1;
   if(ArraySize(window) < size)
      return(false);

   int candidate = lookback;
   double candHigh = window[candidate].high;
   double candLow  = window[candidate].low;

   isSwingHigh = true;
   isSwingLow  = true;
   for(int i=0; i<size; i++)
     {
      if(i == candidate)
         continue;
      if(window[i].high >= candHigh)
         isSwingHigh = false;
      if(window[i].low <= candLow)
         isSwingLow = false;
     }

   highPrice = candHigh;
   highTime  = window[candidate].time;
   lowPrice  = candLow;
   lowTime   = window[candidate].time;
   return(true);
  }

//--- Convenience wrapper: evaluate the window and append any newly confirmed swing(s)
//--- directly to the output arrays.
bool G01_UpdateConfirmedSwings(const SBar &window[],int lookback,
                                SSwingPoint &highsOut[],SSwingPoint &lowsOut[])
  {
   bool isHigh,isLow; double hp,lp; datetime ht,lt;
   if(!G01_EvaluateSwingWindow(window,lookback,isHigh,hp,ht,isLow,lp,lt))
      return(false);
   if(isHigh)
      G01_AppendSwing(highsOut,ht,hp,true);
   if(isLow)
      G01_AppendSwing(lowsOut,lt,lp,false);
   return(true);
  }

//--- Most recent confirmed swing point in the array (last element).
bool G01_GetMostRecentSwing(const SSwingPoint &arr[],SSwingPoint &out)
  {
   int n = ArraySize(arr);
   if(n == 0)
      return(false);
   out = arr[n-1];
   return(true);
  }

#endif // AT24_G01_SWINGS_MQH
