//+------------------------------------------------------------------+
//| USTECHIndexSniper.mq5                                           |
//| USTECH Index Sniper - US Tech index M1 pending-stop trend       |
//| continuation (M5 trend + fair value gap, break-even + trailing) |
//+------------------------------------------------------------------+
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property strict
#property version   "1.00"
#property description "USTECH Index Sniper - Powered by ALGOTRADERS24 AI"
#property description "US Tech index M1 pending-stop trend continuation"
#include <Trade/Trade.mqh>
CTrade trade;

input group "=== Master Toggles ==="
input bool EnableSessionFilter       = true;
input bool EnableSpreadFilter        = true;
input bool EnableTrendFilter         = true;
input bool EnableFVGFilter           = true;
input bool EnableCVDFilter           = true;
input bool EnableRegimeFilter        = true;
input bool EnableOFIFilter           = true;
input bool EnableBreakEven           = true;
input bool EnableATRTrailing         = true;
input bool EnableFixedPipsTrailing   = true;
input bool EnablePendingExpiry       = true;
input bool EnableDebugLogs           = true;

input group "=== Identity and Risk ==="
input long   MagicNumber              = 20260923;
input bool   UseRiskLot               = true;
input double RiskPercent              = 0.50;
input double FixedLot                 = 0.01;
input int    DeviationPoints          = 30;

input group "=== Broker / Index Point Definition ==="
input double PipSize                  = 0.01; // 1 pip = 0.01 price units; verify your broker's digits for the index symbol
input int    MaxSpreadPoints          = 80;
input int    ExtraStopsBufferPoints   = 10;

input group "=== Risk Management (Pips Base) ==="
input bool   UsePipsForSLTP           = true;   // Use Pips for SL/TP (False = Use ATR/RR)
input int    StopLossPips             = 50;     // Stop Loss (Pips)
input int    TakeProfitPips           = 100;    // Take Profit (Pips)

input group "=== Exit: Break Even & Trailing (Pips Base) ==="
input bool   UsePipsForTrailing       = true;   // Use Pips for BE/Trailing (False = Use Points/ATR)
input int    BreakEvenTriggerPips     = 20;     // Break Even Trigger (Pips, 0=Disable)
input int    BreakEvenLockPips        = 5;      // Break Even Lock Profit (Pips)
input int    TrailingStopPips         = 30;     // Trailing Stop Distance (Pips, 0=Disable)
input int    TrailingStepPips         = 10;     // Trailing Step (Pips)

input group "=== UK / US Session: Broker Server Time ==="
input int LondonStartHour             = 7;
input int LondonEndHour               = 16;
input int NewYorkStartHour            = 12;
input int NewYorkEndHour              = 21;

input group "=== Trend and FVG ==="
input int    TrendEMAPeriod           = 50;
input ENUM_TIMEFRAMES TrendTF         = PERIOD_M5;
input int    FVGMinPips               = 8;
input int    BreakoutLookbackBars     = 5;
input int    EntryBufferPoints        = 30;
input int    CooldownSeconds          = 30;
input int    PendingExpiryMinutes     = 3;

input group "=== CVD Proxy: Closed M1 Bars ==="
input int    CVDPeriod                = 20;
input double CVDMinPressure           = 0.15;

input group "=== Regime: Closed M1 Bars ==="
input int    EntropyPeriod            = 20;
input double MaxTrendEntropy          = 0.58;
input int    VolatilityPeriod         = 15;
input double MinVolatilityRatio       = 1.05;

input group "=== Phase 4 OFI: Recent Tick Flow ==="
input int    OFILookbackSeconds       = 60;
input int    OFIMaxTicks              = 2000;
input int    OFIMinClassifiedTicks    = 40;
input double OFIMinRatio              = 1.35;
input double OFIMinNetPressure        = 0.15;
input bool   OFIUseTradeFlags         = true;
input bool   OFIUseMidPriceFallback   = true;

input group "=== Initial Stop Loss (Fallback ATR/RR) ==="
input int    ATRPeriod                = 14;
input double InitialSL_ATRMultiplier  = 1.50;
input bool   EnableHardTakeProfit     = false;
input double TakeProfitRR             = 3.0;

input group "=== Exit: Fallback (Points/ATR Trailing) ==="
input int    BreakEvenStartPoints     = 100;
input int    BreakEvenLockPoints      = 20;
input int    ATRTrailStartPoints      = 150;
input double ATRTrailMultiplier       = 1.20;
input int    FixedTrailStartPoints    = 100;
input double FixedTrailPips           = 10.0;
input int    MinTrailStepPoints       = 20;

struct SOrderFlow
{
   int buyTicks, sellTicks, neutralTicks;
   double buyVolume, sellVolume, netPressure, ratio;
   bool valid;
};

int g_atrHandle = INVALID_HANDLE;
int g_emaHandle = INVALID_HANDLE;
datetime g_lastBar = 0;
datetime g_lastAction = 0;

int OnInit()
{
   if(PipSize <= 0.0 || RiskPercent <= 0.0 || FixedLot <= 0.0 || ATRPeriod < 2 || EntropyPeriod < 5)
      return INIT_PARAMETERS_INCORRECT;
   
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   
   Print("=== USTECH Index Sniper v1.00 initialized ===");
   g_atrHandle = iATR(_Symbol, PERIOD_M1, ATRPeriod);
   g_emaHandle = iMA(_Symbol, TrendTF, TrendEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
   
   if(g_atrHandle == INVALID_HANDLE || g_emaHandle == INVALID_HANDLE)
   {
      Print("Indicator handle creation failed. Error=", GetLastError());
      return INIT_FAILED;
   }
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(g_atrHandle != INVALID_HANDLE) IndicatorRelease(g_atrHandle);
   if(g_emaHandle != INVALID_HANDLE) IndicatorRelease(g_emaHandle);
}

void OnTick()
{
   ManageTrailingEveryTick();
   MaintainPendingOrdersEveryTick();
   
   if(!IsNewM1Bar()) return;
   if(EnableSessionFilter && !IsEntrySessionOpen()) return;
   if(EnableSpreadFilter && !IsSpreadAcceptable()) return;
   if(CountMyPositions() > 0 || CountMyPendingOrders() > 0) return;
   if((TimeCurrent() - g_lastAction) < CooldownSeconds) return;
   
   int direction = GetEntryDirection();
   if(direction == 0) return;
   
   if(EnableOFIFilter)
   {
      SOrderFlow flow = ReadOrderFlow();
      if(!PassesOFI(direction, flow)) return;
   }
   
   PlaceContinuationStop(direction);
}

bool IsNewM1Bar()
{
   datetime t = iTime(_Symbol, PERIOD_M1, 0);
   if(t == 0 || t == g_lastBar) return false;
   g_lastBar = t;
   return true;
}

int GetEntryDirection()
{
   int trend = GetHTFTrend();
   if(EnableTrendFilter && trend == 0) return 0;
   int direction = trend;
   if(!EnableTrendFilter) direction = GetLastClosedBarDirection();
   if(direction == 0) return 0;
   
   if(EnableFVGFilter)
   {
      int fvg = GetFreshFVGDirection();
      if(fvg == 0 || fvg != direction) return 0;
   }
   if(EnableCVDFilter && !PassesCVD(direction)) return 0;
   if(EnableRegimeFilter && !IsTrendingRegime()) return 0;
   return direction;
}

int GetHTFTrend()
{
   double ema[]; ArraySetAsSeries(ema, true);
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyBuffer(g_emaHandle, 0, 1, 2, ema) != 2) return 0;
   if(CopyRates(_Symbol, TrendTF, 1, 1, r) != 1) return 0;
   if(r[0].close > ema[0] && ema[0] > ema[1]) return 1;
   if(r[0].close < ema[0] && ema[0] < ema[1]) return -1;
   return 0;
}

int GetLastClosedBarDirection()
{
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, PERIOD_M1, 1, 1, r) != 1) return 0;
   if(r[0].close > r[0].open) return 1;
   if(r[0].close < r[0].open) return -1;
   return 0;
}

int GetFreshFVGDirection()
{
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, PERIOD_M1, 1, 3, r) != 3) return 0;
   double minGap = FVGMinPips * PipSize;
   if(r[0].low > r[2].high && r[1].close > r[1].open && (r[0].low-r[2].high) >= minGap) return 1;
   if(r[0].high < r[2].low && r[1].close < r[1].open && (r[2].low-r[0].high) >= minGap) return -1;
   return 0;
}

bool PassesCVD(const int direction)
{
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, PERIOD_M1, 1, CVDPeriod, r) != CVDPeriod) return false;
   double signedFlow=0.0, absoluteFlow=0.0;
   for(int i=0;i<CVDPeriod;i++)
   {
      double range=r[i].high-r[i].low;
      if(range<=0.0) continue;
      double pressure=((r[i].close-r[i].low)/range)*2.0-1.0;
      double vol=(double)r[i].tick_volume;
      signedFlow += pressure*vol;
      absoluteFlow += vol;
   }
   if(absoluteFlow<=0.0) return false;
   double normalized=signedFlow/absoluteFlow;
   Log(StringFormat("CVD proxy=%.3f",normalized));
   return (direction>0) ? normalized>=CVDMinPressure : normalized<=-CVDMinPressure;
}

double NormalizedEntropy(const MqlRates &r[], const int n)
{
   int down=0, flat=0, up=0;
   double flatBand=2.0*_Point;
   for(int i=0;i<n;i++)
   {
      double delta=r[i].close-r[i+1].close;
      if(delta>flatBand) up++; else if(delta<-flatBand) down++; else flat++;
   }
   double counts[3]={double(down),double(flat),double(up)};
   double h=0.0;
   for(int k=0;k<3;k++) if(counts[k]>0.0)
   {
      double p=counts[k]/n;
      h-=p*MathLog(p)/MathLog(2.0);
   }
   return h/(MathLog(3.0)/MathLog(2.0));
}

bool IsTrendingRegime()
{
   int total=EntropyPeriod + 2*VolatilityPeriod + 2;
   MqlRates r[]; ArraySetAsSeries(r,true);
   if(CopyRates(_Symbol,PERIOD_M1,1,total,r)!=total) return false;
   double entropy=NormalizedEntropy(r,EntropyPeriod);
   double now=0.0, previous=0.0;
   for(int i=0;i<VolatilityPeriod;i++) now += r[i].high-r[i].low;
   for(int i=VolatilityPeriod;i<2*VolatilityPeriod;i++) previous += r[i].high-r[i].low;
   if(previous<=0.0) return false;
   double ratio=now/previous;
   Log(StringFormat("Regime entropy=%.3f volRatio=%.3f",entropy,ratio));
   return entropy<=MaxTrendEntropy && ratio>=MinVolatilityRatio;
}

SOrderFlow ReadOrderFlow()
{
   SOrderFlow f; ZeroMemory(f);
   MqlTick ticks[];
   ulong from=(ulong)(TimeCurrent()-OFILookbackSeconds)*1000;
   int n=CopyTicks(_Symbol,ticks,COPY_TICKS_ALL,from,OFIMaxTicks);
   if(n<=0) return f;
   double prevMid=0.0;
   for(int i=0;i<n;i++)
   {
      double v=ticks[i].volume_real;
      if(v<=0.0) v=(ticks[i].volume>0 ? (double)ticks[i].volume : 1.0);
      bool classified=false;
      if(OFIUseTradeFlags && (ticks[i].flags&TICK_FLAG_BUY)!=0)
      { f.buyTicks++; f.buyVolume+=v; classified=true; }
      else if(OFIUseTradeFlags && (ticks[i].flags&TICK_FLAG_SELL)!=0)
      { f.sellTicks++; f.sellVolume+=v; classified=true; }
      if(!classified && OFIUseMidPriceFallback)
      {
         double mid=0.0;
         if(ticks[i].bid>0.0 && ticks[i].ask>0.0) mid=(ticks[i].bid+ticks[i].ask)*0.5;
         else if(ticks[i].last>0.0) mid=ticks[i].last;
         if(prevMid>0.0 && mid>prevMid) { f.buyTicks++; f.buyVolume+=v; }
         else if(prevMid>0.0 && mid<prevMid) { f.sellTicks++; f.sellVolume+=v; }
         else f.neutralTicks++;
         if(mid>0.0) prevMid=mid;
      }
   }
   double total=f.buyVolume+f.sellVolume;
   if(total>0.0)
   {
      f.netPressure=(f.buyVolume-f.sellVolume)/total;
      f.ratio=(f.buyVolume+0.000001)/(f.sellVolume+0.000001);
   }
   f.valid=(f.buyTicks+f.sellTicks)>=OFIMinClassifiedTicks;
   return f;
}

bool PassesOFI(const int direction,const SOrderFlow &f)
{
   if(!f.valid) { Log("OFI rejected: not enough classified ticks"); return false; }
   bool pass=(direction>0) ? (f.ratio>=OFIMinRatio && f.netPressure>=OFIMinNetPressure)
                            : ((1.0/f.ratio)>=OFIMinRatio && f.netPressure<=-OFIMinNetPressure);
   Log(StringFormat("OFI buy=%d sell=%d ratio=%.2f net=%.3f pass=%s",f.buyTicks,f.sellTicks,f.ratio,f.netPressure,pass?"true":"false"));
   return pass;
}

void PlaceContinuationStop(const int direction)
{
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   double atr=GetClosedATR(); if(atr<=0.0) return;
   MqlRates r[]; ArraySetAsSeries(r,true);
   if(CopyRates(_Symbol,PERIOD_M1,1,BreakoutLookbackBars,r)!=BreakoutLookbackBars) return;
   double high=r[0].high, low=r[0].low;
   for(int i=1;i<BreakoutLookbackBars;i++){ if(r[i].high>high) high=r[i].high; if(r[i].low<low) low=r[i].low; }
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   int stops=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist=(stops+ExtraStopsBufferPoints)*_Point;
   
   double entry,sl=0.0,tp=0.0,lot;
   ENUM_ORDER_TYPE_TIME tm=EnablePendingExpiry ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;
   datetime expiry=EnablePendingExpiry ? TimeCurrent()+PendingExpiryMinutes*60 : 0;
   bool ok=false;
   
   if(direction>0)
   {
      entry=MathMax(high+EntryBufferPoints*_Point,tick.ask+minDist);
      
      if(UsePipsForSLTP) {
         sl = entry - StopLossPips * PipSize;
         tp = entry + TakeProfitPips * PipSize;
      } else {
         sl = entry - atr * InitialSL_ATRMultiplier;
         if(EnableHardTakeProfit) tp = entry + (entry - sl) * TakeProfitRR;
      }
      
      entry=NormalizeDouble(entry,digits); 
      sl=NormalizeDouble(sl,digits);
      if(tp>0) tp=NormalizeDouble(tp,digits);
      
      lot=CalculateVolume(ORDER_TYPE_BUY,entry,sl);
      if(lot>0.0) ok=trade.BuyStop(lot,entry,_Symbol,sl,tp,tm,expiry,"USTECHSniper_Buy");
   }
   else
   {
      entry=MathMin(low-EntryBufferPoints*_Point,tick.bid-minDist);
      
      if(UsePipsForSLTP) {
         sl = entry + StopLossPips * PipSize;
         tp = entry - TakeProfitPips * PipSize;
      } else {
         sl = entry + atr * InitialSL_ATRMultiplier;
         if(EnableHardTakeProfit) tp = entry - (sl - entry) * TakeProfitRR;
      }
      
      entry=NormalizeDouble(entry,digits); 
      sl=NormalizeDouble(sl,digits);
      if(tp>0) tp=NormalizeDouble(tp,digits);
      
      lot=CalculateVolume(ORDER_TYPE_SELL,entry,sl);
      if(lot>0.0) ok=trade.SellStop(lot,entry,_Symbol,sl,tp,tm,expiry,"USTECHSniper_Sell");
   }
   if(ok) { g_lastAction=TimeCurrent(); Log(StringFormat("Pending placed dir=%d lot=%.2f entry=%.*f sl=%.*f",direction,lot,digits,entry,digits,sl)); }
   else Print("Pending order failed. Retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
}

double CalculateVolume(const ENUM_ORDER_TYPE orderType,const double entry,const double sl)
{
   if(!UseRiskLot) return NormalizeVolume(FixedLot);
   double lossPerLot=0.0;
   if(!OrderCalcProfit(orderType,_Symbol,1.0,entry,sl,lossPerLot)) { Print("OrderCalcProfit failed ",GetLastError()); return 0.0; }
   lossPerLot=MathAbs(lossPerLot);
   if(lossPerLot<=0.0) return 0.0;
   double risk=AccountInfoDouble(ACCOUNT_EQUITY)*RiskPercent/100.0;
   double raw=risk/lossPerLot;
   double min=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   if(raw<min) { Log("Risk volume below broker minimum: trade skipped"); return 0.0; }
   return NormalizeVolume(raw);
}

double NormalizeVolume(double v)
{
   double min=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN), max=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX), step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   v=MathFloor(v/step)*step; v=MathMax(min,MathMin(max,v));
   return NormalizeDouble(v,(int)MathRound(-MathLog10(step)));
}

void ManageTrailingEveryTick()
{
   MqlTick tick; if(!SymbolInfoTick(_Symbol,tick)) return;
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   int stops=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDist=(stops+ExtraStopsBufferPoints)*_Point;
   
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i); if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol || PositionGetInteger(POSITION_MAGIC)!=MagicNumber) continue;
      ENUM_POSITION_TYPE type=(ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double open=PositionGetDouble(POSITION_PRICE_OPEN), oldSL=PositionGetDouble(POSITION_SL), oldTP=PositionGetDouble(POSITION_TP);
      double price=(type==POSITION_TYPE_BUY ? tick.bid : tick.ask);
      
      double profitPts=(type==POSITION_TYPE_BUY ? price-open : open-price)/_Point;
      double profitPips=(type==POSITION_TYPE_BUY ? price-open : open-price)/PipSize;
      double candidate=oldSL;
      
      if(UsePipsForTrailing)
      {
         if(BreakEvenTriggerPips > 0 && profitPips >= BreakEvenTriggerPips)
         {
            double be=(type==POSITION_TYPE_BUY ? open+BreakEvenLockPips*PipSize : open-BreakEvenLockPips*PipSize);
            if(type==POSITION_TYPE_BUY && (candidate==0.0 || be>candidate)) candidate=be;
            if(type==POSITION_TYPE_SELL && (candidate==0.0 || be<candidate)) candidate=be;
         }
         if(TrailingStopPips > 0 && profitPips >= TrailingStopPips)
         {
            double p=(type==POSITION_TYPE_BUY ? price-TrailingStopPips*PipSize : price+TrailingStopPips*PipSize);
            if(type==POSITION_TYPE_BUY && (candidate==0.0 || p>candidate)) candidate=p;
            if(type==POSITION_TYPE_SELL && (candidate==0.0 || p<candidate)) candidate=p;
         }
      }
      else
      {
         if(EnableBreakEven && profitPts>=BreakEvenStartPoints)
         {
            double be=(type==POSITION_TYPE_BUY ? open+BreakEvenLockPoints*_Point : open-BreakEvenLockPoints*_Point);
            if(type==POSITION_TYPE_BUY && (candidate==0.0 || be>candidate)) candidate=be;
            if(type==POSITION_TYPE_SELL && (candidate==0.0 || be<candidate)) candidate=be;
         }
         if(EnableATRTrailing && profitPts>=ATRTrailStartPoints)
         {
            double atr=GetClosedATR();
            if(atr>0.0)
            {
               double a=(type==POSITION_TYPE_BUY ? price-atr*ATRTrailMultiplier : price+atr*ATRTrailMultiplier);
               if(type==POSITION_TYPE_BUY && (candidate==0.0 || a>candidate)) candidate=a;
               if(type==POSITION_TYPE_SELL && (candidate==0.0 || a<candidate)) candidate=a;
            }
         }
         if(EnableFixedPipsTrailing && profitPts>=FixedTrailStartPoints)
         {
            double distance=FixedTrailPips*PipSize;
            double p=(type==POSITION_TYPE_BUY ? price-distance : price+distance);
            if(type==POSITION_TYPE_BUY && (candidate==0.0 || p>candidate)) candidate=p;
            if(type==POSITION_TYPE_SELL && (candidate==0.0 || p<candidate)) candidate=p;
         }
      }
      
      if(candidate<=0.0) continue;
      
      if(type==POSITION_TYPE_BUY) candidate=MathMin(candidate,price-minDist);
      else candidate=MathMax(candidate,price+minDist);
      candidate=NormalizeDouble(candidate,digits);
      
      double stepDist = UsePipsForTrailing ? TrailingStepPips * PipSize : MinTrailStepPoints * _Point;
      bool improve=(type==POSITION_TYPE_BUY) ? (oldSL==0.0 || candidate-oldSL>=stepDist)
                                             : (oldSL==0.0 || oldSL-candidate>=stepDist);
      if(improve)
      {
         if(!trade.PositionModify(ticket,candidate,oldTP))
            Print("Trailing modify failed ticket=",ticket," retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
         else Log(StringFormat("Trail modified ticket=%I64u profitPips=%.1f newSL=%.*f",ticket,profitPips,digits,candidate));
      }
   }
}

void MaintainPendingOrdersEveryTick()
{
   bool outSession=EnableSessionFilter && !IsEntrySessionOpen();
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong ticket=OrderGetTicket(i); if(ticket==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol || OrderGetInteger(ORDER_MAGIC)!=MagicNumber) continue;
      datetime expiry=(datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
      bool expired=(expiry>0 && TimeCurrent()>=expiry);
      if(outSession || expired)
      {
         if(trade.OrderDelete(ticket)) g_lastAction=TimeCurrent();
      }
   }
}

double GetClosedATR()
{
   double b[]; ArraySetAsSeries(b,true);
   return CopyBuffer(g_atrHandle,0,1,1,b)==1 ? b[0] : 0.0;
}

bool IsSpreadAcceptable()
{
   MqlTick t; if(!SymbolInfoTick(_Symbol,t)) return false;
   return (t.ask-t.bid)/_Point<=MaxSpreadPoints;
}

bool IsHourInWindow(const int h,const int start,const int end)
{
   if(start==end) return true;
   return start<end ? (h>=start && h<end) : (h>=start || h<end);
}

bool IsEntrySessionOpen()
{
   MqlDateTime x; TimeToStruct(TimeTradeServer(),x);
   return IsHourInWindow(x.hour,LondonStartHour,LondonEndHour) || IsHourInWindow(x.hour,NewYorkStartHour,NewYorkEndHour);
}

int CountMyPositions()
{
   int c=0; for(int i=PositionsTotal()-1;i>=0;i--){ ulong t=PositionGetTicket(i); if(t>0 && PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==MagicNumber) c++; } return c;
}

int CountMyPendingOrders()
{
   int c=0; for(int i=OrdersTotal()-1;i>=0;i--){ ulong t=OrderGetTicket(i); if(t==0 || OrderGetString(ORDER_SYMBOL)!=_Symbol || OrderGetInteger(ORDER_MAGIC)!=MagicNumber) continue; ENUM_ORDER_TYPE q=(ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE); if(q==ORDER_TYPE_BUY_STOP || q==ORDER_TYPE_SELL_STOP) c++; } return c;
}

void Log(const string s){ if(EnableDebugLogs) Print(s); }
//+------------------------------------------------------------------+