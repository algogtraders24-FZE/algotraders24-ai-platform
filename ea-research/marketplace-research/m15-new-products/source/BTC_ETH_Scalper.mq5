//+------------------------------------------------------------------+
//|              BTC_ETH_Scalper.mq5                                 |
//|          Statistical Arbitrage (Mean Reversion) - CRYPTO         |
//|                  BTCUSD vs ETHUSD Correlation                    |
//|                    Version 1.00 (CRYPTO OPTIMIZED)               |
//+------------------------------------------------------------------+
#property copyright "BTC/ETH Crypto Scalper"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\AccountInfo.mqh>

//--- Input Parameters
input string   InpSymbolBTC          = "BTCUSD";    // Check your broker's exact symbol (e.g., BTCUSD, BTCUSDT)
input string   InpSymbolETH          = "ETHUSD";    // Check your broker's exact symbol (e.g., ETHUSD, ETHUSDT)
input int      InpRatioMAPeriod      = 100;         // Lookback period for Mean calculation
input double   InpZScoreEntry        = 2.5;         // Higher threshold for crypto volatility (Default 2.5)
input double   InpZScoreExit         = 0.5;         // Exit when ratio reverts

//--- LOT SIZE SETTINGS
input int      InpLotMode            = 1;           // 1=Fixed Lot, 2=Percentage Risk
input double   InpFixedLotBTC        = 0.01;        // Fixed lot for BTC (if Mode=1)
input double   InpRiskPercent        = 1.0;         // Risk % of Balance (if Mode=2)
input double   InpMaxLotBTC          = 1.0;         // Max lot for BTC
input double   InpMaxLotETH          = 10.0;        // Max lot for ETH

//--- RISK & SPREAD SETTINGS
input int      InpMaxTradeDuration   = 7200;        // Max duration in seconds (2 hours for crypto)
input double   InpMaxSpreadPercent   = 0.20;        // MAX SPREAD IN % (Solves 2/3 digit broker issue!)
input int      InpMagicNumber        = 887799;
input bool     InpShowDebug          = true;

//--- Global Objects & Variables
CTrade        trade;
CPositionInfo pos;

double contractBTC = 0;
double contractETH = 0;
datetime lastDebugTime = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   if(!SymbolSelect(InpSymbolBTC, true) || !SymbolSelect(InpSymbolETH, true))
   {
      Print("ERROR: Symbols not found. Check Market Watch for exact names (e.g., BTCUSDm).");
      return(INIT_FAILED);
   }

   contractBTC = SymbolInfoDouble(InpSymbolBTC, SYMBOL_TRADE_CONTRACT_SIZE);
   contractETH = SymbolInfoDouble(InpSymbolETH, SYMBOL_TRADE_CONTRACT_SIZE);

   // Fallback for crypto CFDs
   if(contractBTC <= 0) contractBTC = 1.0;
   if(contractETH <= 0) contractETH = 1.0;

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(50); // Higher slippage tolerance for crypto
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   Print("=========================================");
   Print("BTC/ETH Crypto Scalper v1.00 Loaded");
   Print("BTC Contract: ", contractBTC, " | ETH Contract: ", contractETH);
   Print("Leverage: 1:", (int)AccountInfoInteger(ACCOUNT_LEVERAGE));
   Print("=========================================");

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) {}
//+------------------------------------------------------------------+
void OnTick()
{
   int openPositions = CountPositionsByMagic();

   double zscore = 0;
   if(!CalculateZScore(zscore)) return;

   if(InpShowDebug && (TimeCurrent() - lastDebugTime >= 5))
   {
      PrintFormat("Z-Score: %.3f | Pos: %d | Equity: $%.2f", zscore, openPositions, AccountInfoDouble(ACCOUNT_EQUITY));
      lastDebugTime = TimeCurrent();
   }

   if(openPositions > 0)
   {
      ManageOpenTrade(zscore);
      return;
   }

   if(MathAbs(zscore) >= InpZScoreEntry)
   {
      // Crypto Spread Check (Percentage based to avoid 2/3 digit issues)
      if(!IsSpreadAcceptable())
      {
         if(InpShowDebug) Print("Spread too high (>%), skipping.");
         return;
      }

      double lotBTC = CalculateLotSize(InpSymbolBTC);
      if(lotBTC <= 0)
      {
         Print("ERROR: Invalid lot size calculated.");
         return;
      }

      if(zscore >= InpZScoreEntry)
      {
         PrintFormat("ENTRY: Z=%.2f. SELL BTC, BUY ETH. LotBTC=%.4f", zscore, lotBTC);
         ExecutePairTrade(ORDER_TYPE_SELL, InpSymbolBTC, ORDER_TYPE_BUY, InpSymbolETH, lotBTC);
      }
      else if(zscore <= -InpZScoreEntry)
      {
         PrintFormat("ENTRY: Z=%.2f. BUY BTC, SELL ETH. LotBTC=%.4f", zscore, lotBTC);
         ExecutePairTrade(ORDER_TYPE_BUY, InpSymbolBTC, ORDER_TYPE_SELL, InpSymbolETH, lotBTC);
      }
   }
}

//+------------------------------------------------------------------+
//| Calculate Z-Score of BTC/ETH Ratio                               |
//+------------------------------------------------------------------+
bool CalculateZScore(double &zscore)
{
   double btcClose[], ethClose[];
   ArraySetAsSeries(btcClose, true);
   ArraySetAsSeries(ethClose, true);

   int barsBTC = CopyClose(InpSymbolBTC, PERIOD_CURRENT, 0, InpRatioMAPeriod, btcClose);
   int barsETH = CopyClose(InpSymbolETH, PERIOD_CURRENT, 0, InpRatioMAPeriod, ethClose);

   if(barsBTC < InpRatioMAPeriod || barsETH < InpRatioMAPeriod) return false;

   double ratios[];
   ArrayResize(ratios, InpRatioMAPeriod);
   double sum = 0;
   int validCount = 0;

   for(int i = 0; i < InpRatioMAPeriod; i++)
   {
      if(ethClose[i] > 0 && btcClose[i] > 0)
      {
         ratios[i] = btcClose[i] / ethClose[i];
         sum += ratios[i];
         validCount++;
      }
      else ratios[i] = 0;
   }

   if(validCount < InpRatioMAPeriod / 2) return false;

   double mean = sum / validCount;
   double varianceSum = 0;

   for(int i = 0; i < InpRatioMAPeriod; i++)
   {
      if(ratios[i] > 0) varianceSum += MathPow(ratios[i] - mean, 2);
   }

   double stdDev = MathSqrt(varianceSum / validCount);
   if(stdDev == 0) return false;

   double currentRatio = btcClose[0] / ethClose[0];
   zscore = (currentRatio - mean) / stdDev;

   return true;
}

//+------------------------------------------------------------------+
//| Calculate Lot Size                                               |
//+------------------------------------------------------------------+
double CalculateLotSize(string symbol)
{
   double lot = 0;

   if(InpLotMode == 1)
   {
      if(symbol == InpSymbolBTC)
         lot = InpFixedLotBTC;
      else
      {
         double priceBTC = SymbolInfoDouble(InpSymbolBTC, SYMBOL_ASK);
         double priceETH = SymbolInfoDouble(InpSymbolETH, SYMBOL_ASK);
         if(priceBTC <= 0 || priceETH <= 0) return 0;
         lot = (InpFixedLotBTC * contractBTC * priceBTC) / (contractETH * priceETH);
      }
   }
   else if(InpLotMode == 2)
   {
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      if(balance <= 0) balance = AccountInfoDouble(ACCOUNT_EQUITY);

      double riskAmount = balance * InpRiskPercent / 100.0;
      double price = SymbolInfoDouble(symbol, SYMBOL_ASK);
      if(price <= 0) return 0;

      double contractSize = (symbol == InpSymbolBTC) ? contractBTC : contractETH;
      lot = riskAmount / (contractSize * price);

      double marginRequired = CalculateMarginRequired(symbol, lot);
      double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);

      if(freeMargin > 0 && marginRequired > freeMargin * 0.5)
      {
         lot = lot * (freeMargin * 0.5 / marginRequired);
      }
   }

   lot = NormalizeVolume(symbol, lot);
   double maxLot = (symbol == InpSymbolBTC) ? InpMaxLotBTC : InpMaxLotETH;
   if(lot > maxLot) lot = maxLot;

   return lot;
}

//+------------------------------------------------------------------+
double CalculateMarginRequired(string symbol, double lots)
{
   double price = SymbolInfoDouble(symbol, SYMBOL_ASK);
   if(price <= 0) return 0;

   double contractSize = (symbol == InpSymbolBTC) ? contractBTC : contractETH;
   long leverage = AccountInfoInteger(ACCOUNT_LEVERAGE);
   if(leverage <= 0) leverage = 100;

   return (lots * contractSize * price) / leverage;
}

//+------------------------------------------------------------------+
//| Execute Pair Trade                                               |
//+------------------------------------------------------------------+
void ExecutePairTrade(ENUM_ORDER_TYPE typeBTC, string symBTC, ENUM_ORDER_TYPE typeETH, string symETH, double lotBTC)
{
   double priceBTC = (typeBTC == ORDER_TYPE_BUY) ? SymbolInfoDouble(symBTC, SYMBOL_ASK) : SymbolInfoDouble(symBTC, SYMBOL_BID);
   double priceETH = (typeETH == ORDER_TYPE_BUY) ? SymbolInfoDouble(symETH, SYMBOL_ASK) : SymbolInfoDouble(symETH, SYMBOL_BID);

   if(priceBTC <= 0 || priceETH <= 0) return;

   double lotETH = (lotBTC * contractBTC * priceBTC) / (contractETH * priceETH);

   lotBTC = NormalizeVolume(symBTC, lotBTC);
   lotETH = NormalizeVolume(symETH, lotETH);

   double marginBTC = CalculateMarginRequired(symBTC, lotBTC);
   double marginETH = CalculateMarginRequired(symETH, lotETH);
   double totalMargin = marginBTC + marginETH;
   double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);

   if(totalMargin > freeMargin)
   {
      Print("ERROR: Insufficient margin. Req: $", totalMargin, " | Free: $", freeMargin);
      return;
   }

   PrintFormat("LOTS -> BTC: %.4f | ETH: %.4f | Margin: $%.2f", lotBTC, lotETH, totalMargin);

   bool s1 = false, s2 = false;
   if(typeBTC == ORDER_TYPE_BUY) s1 = trade.Buy(lotBTC, symBTC); else s1 = trade.Sell(lotBTC, symBTC);
   if(typeETH == ORDER_TYPE_BUY) s2 = trade.Buy(lotETH, symETH); else s2 = trade.Sell(lotETH, symETH);

   if(s1 && s2) Print("CRYPTO PAIR OPENED");
   else
   {
      Print("CRYPTO PAIR FAILED. Closing partials...");
      if(s1) ClosePositionsBySymbol(symBTC);
      if(s2) ClosePositionsBySymbol(symETH);
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
      double profit = GetTotalProfitByMagic();
      // Avoid closing if profit is too small to cover crypto commissions
      if(profit > 1.00 || profit < -5.00)
      {
         PrintFormat("Mean Reversion! Z=%.2f | Profit: $%.2f", currentZScore, profit);
         CloseAllByMagic();
      }
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

   return NormalizeDouble(volume, 2);
}

//+------------------------------------------------------------------+
//| CRYPTO SPREAD CHECK (Percentage Based)                           |
//| Works correctly for both 2-digit and 3-digit brokers             |
//+------------------------------------------------------------------+
bool IsSpreadAcceptable()
{
   double askBTC = SymbolInfoDouble(InpSymbolBTC, SYMBOL_ASK);
   double bidBTC = SymbolInfoDouble(InpSymbolBTC, SYMBOL_BID);
   double askETH = SymbolInfoDouble(InpSymbolETH, SYMBOL_ASK);
   double bidETH = SymbolInfoDouble(InpSymbolETH, SYMBOL_BID);

   if(askBTC <= 0 || askETH <= 0) return false;

   // Calculate spread as a percentage of price
   double spreadBTC_pct = ((askBTC - bidBTC) / askBTC) * 100.0;
   double spreadETH_pct = ((askETH - bidETH) / askETH) * 100.0;

   if(InpShowDebug && (TimeCurrent() - lastDebugTime >= 5))
      PrintFormat("Spreads -> BTC: %.3f%% | ETH: %.3f%% | Max Allowed: %.2f%%", spreadBTC_pct, spreadETH_pct, InpMaxSpreadPercent);

   return (spreadBTC_pct <= InpMaxSpreadPercent && spreadETH_pct <= InpMaxSpreadPercent);
}

//+------------------------------------------------------------------+
int CountPositionsByMagic()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber) count++;
   return count;
}

datetime GetFirstOpenTime()
{
   datetime earliest = TimeCurrent();
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber && pos.Time() < earliest) earliest = pos.Time();
   return earliest;
}

double GetTotalProfitByMagic()
{
   double profit = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber) profit += pos.Profit() + pos.Swap() + pos.Commission();
   return profit;
}

void CloseAllByMagic()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(pos.SelectByIndex(i) && pos.Magic() == InpMagicNumber) trade.PositionClose(pos.Ticket());
}

void ClosePositionsBySymbol(string symbol)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(pos.SelectByIndex(i) && pos.Symbol() == symbol && pos.Magic() == InpMagicNumber) trade.PositionClose(pos.Ticket());
}
//+------------------------------------------------------------------+
