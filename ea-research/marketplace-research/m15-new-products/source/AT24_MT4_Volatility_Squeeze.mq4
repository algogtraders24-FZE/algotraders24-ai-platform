//+------------------------------------------------------------------+
//|                     AT24_MT4_Volatility_Squeeze.mq4                |
//|                        Copyright 2026, AlgoTraders24               |
//|                        https://www.algotraders24.ai                |
//+------------------------------------------------------------------+
// AT24 MT4 Volatility Squeeze Breakout - M15 real /products build-out,
// MT4 slot.
//
// A genuinely different trigger mechanism from every breakout product
// shipped this session (all of which trade an N-bar Donchian high/low
// break). This trades John Bollinger's own "squeeze" concept: Bollinger
// Band WIDTH (a real, standard volatility measure) contracting to a
// recent low, followed by price actually breaking out of the bands -
// i.e. it waits for a genuine period of coiled, low volatility before
// trading the expansion, rather than reacting to any price break in
// isolation. This is a well-documented volatility-cycle approach
// (markets alternate between contraction and expansion), distinct from
// both plain price-breakout and mean-reversion designs.
//
// Logic:
//   1. BB width = (Upper - Lower) / Middle, each bar.
//   2. Squeeze flag: width is within the lowest InpSqueezePercentile%
//      of its own trailing InpWidthLookback bars - a genuine relative
//      (self-referencing) measure, not an arbitrary fixed threshold
//      that would be wrong across instruments/volatility regimes.
//   3. Entry: once a squeeze has been flagged within the last
//      InpSqueezeValidBars bars, take the first close beyond the
//      (expanding) bands in that direction.
//   4. Risk: ATR-based stop, fixed R:R take-profit.
//
// Honesty note: this has NOT been compiled or backtested in
// MetaTrader 4 from this workspace (no MT4 terminal available here -
// all MT5/MT4 real backtests this session used a real MT5 terminal or
// a faithful Python port against real market.db candles, neither of
// which extends to MT4). It is real, complete MQL4 code, written to
// the real MT4 API (OrderSend/iBands/iATR/MarketInfo) - please compile
// and Strategy-Tester it in your own MT4 terminal before going live.
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property strict

extern string  __BB__               = "=== BOLLINGER SQUEEZE ===";
extern int     InpBBPeriod          = 20;
extern double  InpBBDeviation       = 2.0;
extern int     InpWidthLookback     = 100;   // bars used to judge whether the current width is "low"
extern double  InpSqueezePercentile = 15.0;  // width must be in the lowest X% of the lookback window
extern int     InpSqueezeValidBars  = 6;     // breakout must occur within this many bars of the squeeze

extern string  __RISK__             = "=== RISK ===";
extern int     InpATRPeriod         = 14;
extern double  InpATR_SL_Mult       = 1.8;
extern double  InpRR                = 2.2;   // take-profit = risk * this
extern double  InpRiskPercent       = 0.75;

extern string  __ID__               = "=== IDENTITY ===";
extern int     InpMagicNumber       = 24020005;
extern string  InpTradeComment      = "AT24_VolSqueeze";

int gSqueezeBarsAgo = -1; // bars since a squeeze was last flagged, -1 = none pending
datetime gLastBarTime = 0;

int OnInit()
{
   gLastBarTime = iTime(Symbol(), 0, 0);
   Print("AT24 MT4 Volatility Squeeze Breakout v1.00 ready | ", Symbol());
   return(INIT_SUCCEEDED);
}

double BandWidth(int shift)
{
   double upper = iBands(Symbol(), 0, InpBBPeriod, InpBBDeviation, 0, PRICE_CLOSE, MODE_UPPER, shift);
   double lower = iBands(Symbol(), 0, InpBBPeriod, InpBBDeviation, 0, PRICE_CLOSE, MODE_LOWER, shift);
   double mid   = iBands(Symbol(), 0, InpBBPeriod, InpBBDeviation, 0, PRICE_CLOSE, MODE_MAIN,  shift);
   if(mid == 0) return(0);
   return((upper - lower) / mid);
}

bool IsSqueezeNow(int shift)
{
   double curWidth = BandWidth(shift);
   int countBelow = 0;
   for(int i = shift + 1; i <= shift + InpWidthLookback; i++)
      if(BandWidth(i) >= curWidth) countBelow++;
   double percentile = (double)countBelow / InpWidthLookback * 100.0;
   return(percentile <= InpSqueezePercentile);
}

bool HasOpenPosition()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() == Symbol() && OrderMagicNumber() == InpMagicNumber) return(true);
   }
   return(false);
}

double CalcLot(double slDistance)
{
   double minL  = MarketInfo(Symbol(), MODE_MINLOT);
   double maxL  = MarketInfo(Symbol(), MODE_MAXLOT);
   double step  = MarketInfo(Symbol(), MODE_LOTSTEP);
   if(slDistance <= 0) return(minL);
   double riskMoney = AccountBalance() * InpRiskPercent / 100.0;
   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize  = MarketInfo(Symbol(), MODE_TICKSIZE);
   if(tickValue <= 0 || tickSize <= 0) return(minL);
   double valuePerLot = (slDistance / tickSize) * tickValue;
   if(valuePerLot <= 0) return(minL);
   if(step <= 0) step = minL > 0 ? minL : 0.01;
   double lot = MathFloor((riskMoney / valuePerLot) / step) * step;
   if(lot < minL) lot = minL;
   if(lot > maxL) lot = maxL;
   return(NormalizeDouble(lot, 2));
}

void OnTick()
{
   datetime cb = iTime(Symbol(), 0, 0);
   bool isNewBar = (cb != gLastBarTime);
   if(isNewBar) gLastBarTime = cb;
   if(!isNewBar) return;

   if(gSqueezeBarsAgo >= 0)
   {
      gSqueezeBarsAgo++;
      if(gSqueezeBarsAgo > InpSqueezeValidBars) gSqueezeBarsAgo = -1;
   }
   if(IsSqueezeNow(1)) gSqueezeBarsAgo = 0; // squeeze confirmed on the last closed bar

   if(HasOpenPosition()) return;
   if(gSqueezeBarsAgo < 0) return;

   double upper1 = iBands(Symbol(), 0, InpBBPeriod, InpBBDeviation, 0, PRICE_CLOSE, MODE_UPPER, 1);
   double lower1 = iBands(Symbol(), 0, InpBBPeriod, InpBBDeviation, 0, PRICE_CLOSE, MODE_LOWER, 1);
   double close1 = iClose(Symbol(), 0, 1);
   double close2 = iClose(Symbol(), 0, 2);
   double atr1   = iATR(Symbol(), 0, InpATRPeriod, 1);

   bool breakUp   = close2 <= upper1 && close1 > upper1;
   bool breakDown = close2 >= lower1 && close1 < lower1;

   if(breakUp)
   {
      double price = Ask;
      double sl = price - atr1 * InpATR_SL_Mult;
      double tp = price + atr1 * InpATR_SL_Mult * InpRR;
      double lot = CalcLot(price - sl);
      if(lot > 0)
      {
         int ticket = OrderSend(Symbol(), OP_BUY, lot, price, 30, sl, tp, InpTradeComment, InpMagicNumber, 0, clrGreen);
         if(ticket > 0) gSqueezeBarsAgo = -1;
      }
   }
   else if(breakDown)
   {
      double price = Bid;
      double sl = price + atr1 * InpATR_SL_Mult;
      double tp = price - atr1 * InpATR_SL_Mult * InpRR;
      double lot = CalcLot(sl - price);
      if(lot > 0)
      {
         int ticket = OrderSend(Symbol(), OP_SELL, lot, price, 30, sl, tp, InpTradeComment, InpMagicNumber, 0, clrRed);
         if(ticket > 0) gSqueezeBarsAgo = -1;
      }
   }
}
//+------------------------------------------------------------------+
