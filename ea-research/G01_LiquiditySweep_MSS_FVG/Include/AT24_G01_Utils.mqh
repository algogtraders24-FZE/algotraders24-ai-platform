//+------------------------------------------------------------------+
//| AT24_G01_Utils.mqh                                                  |
//| PLATFORM ADAPTER (MT5-specific).                                   |
//|                                                                      |
//| This is the ONLY module allowed to call MT5-only APIs (CopyRates,  |
//| CopyTime, iATR/CopyBuffer, SymbolInfo*). It converts everything to |
//| the plain SBar / SSymbolSpec types defined in Types.mqh so every   |
//| other module (Liquidity, Swings, Sweep, Displacement, MSS, FVG,    |
//| Risk, Filters) is pure platform-agnostic logic.                    |
//|                                                                      |
//| Porting to MT4: rewrite ONLY this file (iOpen/iHigh/iLow/iClose/   |
//| iTime instead of CopyRates, MarketInfo() instead of SymbolInfo*,   |
//| iATR(...,shift) instead of a CopyBuffer handle). Every other file  |
//| in this project is unchanged by an MT4 port.                       |
//+------------------------------------------------------------------+
#ifndef AT24_G01_UTILS_MQH
#define AT24_G01_UTILS_MQH

#include "AT24_G01_Types.mqh"

int g_G01_atrHandle = INVALID_HANDLE;

//--- Create the ATR indicator handle (call once from OnInit)
bool G01_CreateATRHandle(const string symbol,ENUM_TIMEFRAMES tf,int period)
  {
   g_G01_atrHandle = iATR(symbol,tf,period);
   return(g_G01_atrHandle != INVALID_HANDLE);
  }

//--- Release the ATR indicator handle (call once from OnDeinit)
void G01_ReleaseATRHandle()
  {
   if(g_G01_atrHandle != INVALID_HANDLE)
     {
      IndicatorRelease(g_G01_atrHandle);
      g_G01_atrHandle = INVALID_HANDLE;
     }
  }

//--- ATR value for a CLOSED bar (shift 1 = most recently closed). Never allow shift 0.
double G01_GetATR(int shift,bool &ok)
  {
   if(shift < 1)
      shift = 1;
   double buf[];
   ArraySetAsSeries(buf,true);
   ok = false;
   if(g_G01_atrHandle == INVALID_HANDLE)
      return(0.0);
   if(CopyBuffer(g_G01_atrHandle,0,shift,1,buf) != 1)
      return(0.0);
   ok = true;
   return(buf[0]);
  }

//--- Read dynamic symbol trading properties (digits/tick size/tick value/contract size/volume steps).
//--- Never hard-code these -- brokers vary the XAUUSD contract spec.
bool G01_LoadSymbolSpec(const string symbol,SSymbolSpec &spec)
  {
   spec.digits        = (int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   spec.point         = SymbolInfoDouble(symbol,SYMBOL_POINT);
   spec.tick_size     = SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   spec.tick_value    = SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE);
   spec.contract_size = SymbolInfoDouble(symbol,SYMBOL_TRADE_CONTRACT_SIZE);
   spec.volume_min    = SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   spec.volume_max    = SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   spec.volume_step   = SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   return(spec.tick_size > 0.0 && spec.tick_value > 0.0);
  }

//--- Fetch a single CLOSED bar (shift must be >= 1; forming bar 0 is never returned).
bool G01_FetchBar(const string symbol,ENUM_TIMEFRAMES tf,int shift,SBar &bar)
  {
   if(shift < 1)
      shift = 1;
   MqlRates r[];
   ArraySetAsSeries(r,true);
   if(CopyRates(symbol,tf,shift,1,r) != 1)
      return(false);
   bar.time  = r[0].time;
   bar.open  = r[0].open;
   bar.high  = r[0].high;
   bar.low   = r[0].low;
   bar.close = r[0].close;
   return(true);
  }

//--- Fetch a contiguous window of CLOSED bars, most recent first (index 0 = shift 'startShift').
bool G01_FetchBarWindow(const string symbol,ENUM_TIMEFRAMES tf,int startShift,int count,SBar &bars[])
  {
   if(startShift < 1)
      startShift = 1;
   MqlRates r[];
   ArraySetAsSeries(r,true);
   if(CopyRates(symbol,tf,startShift,count,r) != count)
      return(false);
   ArrayResize(bars,count);
   for(int i=0; i<count; i++)
     {
      bars[i].time  = r[i].time;
      bars[i].open  = r[i].open;
      bars[i].high  = r[i].high;
      bars[i].low   = r[i].low;
      bars[i].close = r[i].close;
     }
   return(true);
  }

//--- Previous COMPLETED daily bar (shift 1 on D1 -- never the forming daily candle).
bool G01_FetchPrevDailyBar(const string symbol,SBar &bar)
  {
   return(G01_FetchBar(symbol,PERIOD_D1,1,bar));
  }

//--- Previous COMPLETED weekly bar (shift 1 on W1 -- never the forming weekly candle).
bool G01_FetchPrevWeeklyBar(const string symbol,SBar &bar)
  {
   return(G01_FetchBar(symbol,PERIOD_W1,1,bar));
  }

//--- New-closed-bar detector. Pass a persistent 'lastTime' variable (one per timeframe being
//--- tracked); returns true exactly once when a bar on 'tf' has just closed.
bool G01_IsNewBar(const string symbol,ENUM_TIMEFRAMES tf,datetime &lastTime)
  {
   datetime t[];
   ArraySetAsSeries(t,true);
   if(CopyTime(symbol,tf,0,1,t) != 1)
      return(false);
   if(t[0] != lastTime)
     {
      lastTime = t[0];
      return(true);
     }
   return(false);
  }

#endif // AT24_G01_UTILS_MQH
