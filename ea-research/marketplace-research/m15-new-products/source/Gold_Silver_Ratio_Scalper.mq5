//+------------------------------------------------------------------+
//|              Gold_Silver_Ratio_Scalper.mq5                       |
//|          Statistical Arbitrage (Mean Reversion)                  |
//|                  XAUUSD vs XAGUSD Correlation                    |
//|                         Version 1.01 (FIXED)                     |
//+------------------------------------------------------------------+
#property copyright "Gold/Silver Ratio Scalper"
#property version   "1.01"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>

//--- Input Parameters
input string   InpSymbolGold         = "XAUUSD";
input string   InpSymbolSilver       = "XAGUSD";
input int      InpRatioMAPeriod      = 100;       // Lookback period for Mean calculation
input double   InpZScoreEntry        = 2.0;       // Enter trade when Z-Score > 2.0 or < -2.0
input double   InpZScoreExit         = 0.5;       // Exit trade when Z-Score reverts to < 0.5 or > -0.5
input double   InpBaseLotGold        = 0.01;      // Starting lot size for Gold
input int      InpMaxTradeDuration   = 3600;      // Max trade duration in seconds (1 hour)
input int      InpMaxSpreadPoints    = 30;        // Max allowed spread (in points)
input int      InpMagicNumber        = 887766;
input bool     InpShowDebug          = true;

CTrade        trade;
CPositionInfo pos;
CAccountInfo  account;

double contractGold = 0;
double contractSilver = 0;
datetime lastDebugTime = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(!SymbolSelect(InpSymbolGold, true) || !SymbolSelect(InpSymbolSilver, true))
   {
      Print("ERROR: Symbols not found in Market Watch. Please add XAUUSD and XAGUSD.");
      return(INIT_FAILED);
   }

   // Get contract sizes for dynamic lot balancing
   contractGold = SymbolInfoDouble(InpSymbolGold, SYMBOL_TRADE_CONTRACT_SIZE);
   contractSilver = SymbolInfoDouble(InpSymbolSilver, SYMBOL_TRADE_CONTRACT_SIZE);

   if(contractGold <= 0) contractGold = 100.0;
   if(contractSilver <= 0) contractSilver = 5000.0;

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);

   // FIX: SetTypeFilling returns void, not bool. Just call it directly.
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   Print("=========================================");
   Print("Gold/Silver Ratio Scalper v1.01 Loaded");
   Print("Gold Contract: ", contractGold, " | Silver Contract: ", contractSilver);
   Print("=========================================");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) {}
//+------------------------------------------------------------------+
void OnTick()
{
   // 1. Check if we already have an open pair
   int openPositions = CountPositionsByMagic();

   // 2. Calculate current Z-Score
   double zscore = 0;
   if(!CalculateZScore(zscore)) return;

   // 3. Debug output (every 5 seconds to avoid log spam)
   if(InpShowDebug && (TimeCurrent() - lastDebugTime >= 5))
   {
      PrintFormat("Z-Score: %.3f | Positions: %d", zscore, openPositions);
      lastDebugTime = TimeCurrent();
   }

   // 4. Manage Existing Trade
   if(openPositions > 0)
   {
      ManageOpenTrade(zscore);
      return;
   }

   // 5. Check for New Entry Opportunity
   if(MathAbs(zscore) >= InpZScoreEntry)
   {
      if(!IsSpreadAcceptable())
      {
         if(InpShowDebug) Print("Spread too high, skipping entry.");
         return;
      }

      if(zscore >= InpZScoreEntry)
      {
         PrintFormat("ENTRY: Z=%.2f >= %.2f. SELL Gold, BUY Silver.", zscore, InpZScoreEntry);
         ExecutePairTrade(ORDER_TYPE_SELL, InpSymbolGold, ORDER_TYPE_BUY, InpSymbolSilver);
      }
      else if(zscore <= -InpZScoreEntry)
      {
         PrintFormat("ENTRY: Z=%.2f <= %.2f. BUY Gold, SELL Silver.", zscore, -InpZScoreEntry);
         ExecutePairTrade(ORDER_TYPE_BUY, InpSymbolGold, ORDER_TYPE_SELL, InpSymbolSilver);
      }
   }
}

//+------------------------------------------------------------------+
bool CalculateZScore(double &zscore)
{
   double goldClose[], silverClose[];
   ArraySetAsSeries(goldClose, true);
   ArraySetAsSeries(silverClose, true);

   if(CopyClose(InpSymbolGold, PERIOD_CURRENT, 0, InpRatioMAPeriod, goldClose) < InpRatioMAPeriod) return false;
   if(CopyClose(InpSymbolSilver, PERIOD_CURRENT, 0, InpRatioMAPeriod, silverClose) < InpRatioMAPeriod) return false;

   double ratios[];
   ArrayResize(ratios, InpRatioMAPeriod);
   double sum = 0;
   int validCount = 0;

   for(int i = 0; i < InpRatioMAPeriod; i++)
   {
      if(silverClose[i] > 0 && goldClose[i] > 0)
      {
         ratios[i] = goldClose[i] / silverClose[i];
         sum += ratios[i];
         validCount++;
      }
      else
      {
         ratios[i] = 0;
      }
   }

   if(validCount < InpRatioMAPeriod / 2) return false;

   double mean = sum / validCount;

   double varianceSum = 0;
   for(int i = 0; i < InpRatioMAPeriod; i++)
   {
      if(ratios[i] > 0)
         varianceSum += MathPow(ratios[i] - mean, 2);
   }
   double stdDev = MathSqrt(varianceSum / validCount);

   if(stdDev == 0) return false;

   double currentRatio = goldClose[0] / silverClose[0];
   zscore = (currentRatio - mean) / stdDev;

   return true;
}

//+------------------------------------------------------------------+
void ExecutePairTrade(ENUM_ORDER_TYPE typeGold, string symGold, ENUM_ORDER_TYPE typeSilver, string symSilver)
{
   double priceGold = (typeGold == ORDER_TYPE_BUY) ? SymbolInfoDouble(symGold, SYMBOL_ASK) : SymbolInfoDouble(symGold, SYMBOL_BID);
   double priceSilver = (typeSilver == ORDER_TYPE_BUY) ? SymbolInfoDouble(symSilver, SYMBOL_ASK) : SymbolInfoDouble(symSilver, SYMBOL_BID);

   if(priceGold <= 0 || priceSilver <= 0)
   {
      Print("ERROR: Invalid prices. Gold=", priceGold, " Silver=", priceSilver);
      return;
   }

   double lotGold = InpBaseLotGold;
   double lotSilver = (lotGold * contractGold * priceGold) / (contractSilver * priceSilver);

   lotGold = NormalizeVolume(symGold, lotGold);
   lotSilver = NormalizeVolume(symSilver, lotSilver);

   PrintFormat("LOTS -> Gold: %.2f | Silver: %.2f | Gold$: %.2f | Silver$: %.2f",
               lotGold, lotSilver, priceGold, priceSilver);

   bool success1 = false, success2 = false;

   if(typeGold == ORDER_TYPE_BUY) success1 = trade.Buy(lotGold, symGold);
   else                           success1 = trade.Sell(lotGold, symGold);

   if(typeSilver == ORDER_TYPE_BUY) success2 = trade.Buy(lotSilver, symSilver);
   else                             success2 = trade.Sell(lotSilver, symSilver);

   if(success1 && success2)
   {
      Print("PAIR OPENED");
   }
   else
   {
      Print("PAIR FAILED. Closing partials...");
      if(success1) ClosePositionsBySymbol(symGold);
      if(success2) ClosePositionsBySymbol(symSilver);
   }
}

//+------------------------------------------------------------------+
void ManageOpenTrade(double currentZScore)
{
   datetime firstOpenTime = GetFirstOpenTime();
   if(TimeCurrent() - firstOpenTime >= InpMaxTradeDuration)
   {
      Print("Timeout. Closing.");
      CloseAllByMagic();
      return;
   }

   if(MathAbs(currentZScore) <= InpZScoreExit)
   {
      double totalProfit = GetTotalProfitByMagic();
      PrintFormat("Mean Reversion! Z=%.2f | Profit: $%.2f", currentZScore, totalProfit);
      CloseAllByMagic();
   }
}

//+------------------------------------------------------------------+
double NormalizeVolume(string symbol, double volume)
{
   double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double stepLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   if(stepLot <= 0) stepLot = 0.01;
   if(minLot  <= 0) minLot  = 0.01;

   volume = MathFloor(volume / stepLot + 0.0000001) * stepLot;
   if(volume < minLot) volume = minLot;
   if(volume > maxLot) volume = maxLot;

   return(NormalizeDouble(volume, 2));
}

//+------------------------------------------------------------------+
bool IsSpreadAcceptable()
{
   double pointGold = SymbolInfoDouble(InpSymbolGold, SYMBOL_POINT);
   double pointSilver = SymbolInfoDouble(InpSymbolSilver, SYMBOL_POINT);

   if(pointGold <= 0 || pointSilver <= 0) return false;

   double spreadGold = (SymbolInfoDouble(InpSymbolGold, SYMBOL_ASK) - SymbolInfoDouble(InpSymbolGold, SYMBOL_BID)) / pointGold;
   double spreadSilver = (SymbolInfoDouble(InpSymbolSilver, SYMBOL_ASK) - SymbolInfoDouble(InpSymbolSilver, SYMBOL_BID)) / pointSilver;

   return (spreadGold <= InpMaxSpreadPoints && spreadSilver <= InpMaxSpreadPoints);
}

//+------------------------------------------------------------------+
int CountPositionsByMagic()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber)
         count++;
   }
   return count;
}

//+------------------------------------------------------------------+
datetime GetFirstOpenTime()
{
   datetime earliest = TimeCurrent();
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber)
      {
         if(pos.Time() < earliest) earliest = pos.Time();
      }
   }
   return earliest;
}

//+------------------------------------------------------------------+
double GetTotalProfitByMagic()
{
   double profit = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber)
         profit += pos.Profit() + pos.Swap() + pos.Commission();
   }
   return profit;
}

//+------------------------------------------------------------------+
void CloseAllByMagic()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber)
      {
         trade.PositionClose(pos.Ticket());
      }
   }
}

//+------------------------------------------------------------------+
void ClosePositionsBySymbol(string symbol)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(pos.SelectByIndex(i) && pos.Symbol() == symbol && pos.Magic() == InpMagicNumber)
      {
         trade.PositionClose(pos.Ticket());
      }
   }
}
//+------------------------------------------------------------------+
