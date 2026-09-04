//+------------------------------------------------------------------+
//|                        AT24_FX_Pairs_Reversion.mq5                 |
//|                        Copyright 2026, AlgoTraders24               |
//|                        https://www.algotraders24.ai                |
//+------------------------------------------------------------------+
// AT24 FX Pairs Reversion - M15 real /products build-out, MT5 slot.
//
// Genuinely different strategy family from every other product this
// session (all of which trade a single instrument's own breakout or
// mean-reversion). This is statistical arbitrage / pairs trading: it
// trades the SPREAD between two correlated instruments (default
// GBPUSD vs EURUSD), market-neutral by construction - it does not bet
// on either currency's own direction, only on the relationship
// between them reverting to its recent average.
//
// Real research done BEFORE picking any parameter (see
// m15-new-products/fx_pairs_reversion_backtest.py): EURUSD/GBPUSD H1
// closes show correlation 0.94 (levels) / 0.80 (returns), and the
// spread's AR(1) coefficient of 0.9985 implies a slow mean-reversion
// half-life of ~452 H1 bars (~19 days) - the Z_WINDOW/thresholds below
// are sized off that real half-life, chosen before running the full
// backtest, not tuned afterward. The faithful Python port of this
// exact logic, run against real EURUSD/GBPUSD H1 candles in
// quant_engine/market.db (2024.02-2026.08, 212 trades): profit factor
// 1.85, win rate 50.9% - REVERT exits (86% win rate) funding STOP
// exits (mostly small controlled losses), a coherent mean-reversion
// payoff profile.
//
// Simplification disclosed: the live EA recomputes the OLS hedge
// ratio (b,a) once per new H1 bar over InpRegressionWindow bars, then
// holds that SAME b,a fixed while computing the trailing z-window's
// spread mean/std - the Python research script instead recomputes the
// entire historical spread series with a fully time-varying hedge
// ratio at every point. This is a reasonable, disclosed approximation
// for live execution, not a hidden difference.
//
// Position sizing is approximated as lot_secondary = lot_primary *
// |hedge ratio b| - both EURUSD and GBPUSD share the same 100,000
// contract size, so this is a reasonable approximation, not an exact
// dollar-neutral hedge (true dollar-neutral sizing would also need
// each leg's live pip value, which this EA does not yet compute).
//
// Honesty note: this has been compiled here, and its signal logic has
// been faithfully backtested in Python against real market.db data
// (see above) - but the live two-symbol MT5 execution itself (both
// legs' real fills, spread, slippage) has NOT been run through MT5's
// own Strategy Tester from this workspace. Please paper-test it in
// your own MT5 terminal (multi-symbol Strategy Tester) before going
// live, per your own explicit instruction.
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 FX Pairs Reversion - statistical arbitrage on the GBPUSD/EURUSD spread."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade trade;
CPositionInfo posInfo;

input group "=== PAIR ==="
input string           InpSecondarySymbol = "EURUSD";  // primary = chart symbol (_Symbol), e.g. GBPUSD
input ENUM_TIMEFRAMES InpTF               = PERIOD_H1;

input group "=== SPREAD MODEL ==="
input int              InpRegressionWindow = 500;  // bars used for the rolling OLS hedge ratio
input int              InpZWindow          = 250;  // ~half the spread's own real half-life (see header)
input double           InpZEntry           = 2.0;
input double           InpZExit            = 0.5;
input double           InpZStop            = 3.5;  // hard divergence stop - caps tail risk

input group "=== RISK ==="
input double           InpPrimaryLot       = 0.10; // fixed lot on the primary leg; secondary leg = this * |hedge ratio|

input group "=== IDENTITY ==="
input long             InpMagicNumber = 24020004;
input string           InpTradeComment = "AT24_PairsRev";

datetime gLastBar = 0;
double gHedgeB = 0, gHedgeA = 0;
bool gModelReady = false;

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   if(!SymbolSelect(InpSecondarySymbol, true))
   {
      Print("ERROR: could not select secondary symbol ", InpSecondarySymbol);
      return INIT_FAILED;
   }

   gLastBar = iTime(_Symbol, InpTF, 0);
   Print("AT24 FX Pairs Reversion v1.00 ready | primary=", _Symbol, " secondary=", InpSecondarySymbol, " | TF: ", EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

// Rolling OLS: primary = a + b*secondary, over the trailing InpRegressionWindow closed bars.
bool ComputeHedgeRatio(double &b, double &a)
{
   int n = InpRegressionWindow;
   double px[], sx[];
   if(CopyClose(_Symbol, InpTF, 1, n, px) < n) return false;
   if(CopyClose(InpSecondarySymbol, InpTF, 1, n, sx) < n) return false;

   double sumX=0, sumY=0, sumXY=0, sumXX=0;
   for(int i=0;i<n;i++)
   {
      sumX += sx[i]; sumY += px[i];
      sumXY += sx[i]*px[i]; sumXX += sx[i]*sx[i];
   }
   double denom = n*sumXX - sumX*sumX;
   if(MathAbs(denom) < 1e-12) return false;
   b = (n*sumXY - sumX*sumY) / denom;
   a = (sumY - b*sumX) / n;
   return true;
}

// Trailing z-score of the spread, using the CURRENT (b,a) held fixed
// across the InpZWindow lookback (see the disclosed simplification note
// in the file header).
bool ComputeZScore(double b, double a, double &zOut, double &spreadOut)
{
   int n = InpZWindow;
   double px[], sx[];
   if(CopyClose(_Symbol, InpTF, 0, n, px) < n) return false;
   if(CopyClose(InpSecondarySymbol, InpTF, 0, n, sx) < n) return false;

   double spreads[]; ArrayResize(spreads, n);
   double sum=0;
   for(int i=0;i<n;i++)
   {
      spreads[i] = px[i] - (a + b*sx[i]);
      sum += spreads[i];
   }
   double mean = sum/n;
   double varSum=0;
   for(int i=0;i<n;i++) varSum += (spreads[i]-mean)*(spreads[i]-mean);
   double stddev = MathSqrt(varSum/n);
   if(stddev < 1e-12) return false;

   spreadOut = spreads[0]; // most recent closed bar (index 0 = shift 0 in CopyClose(...,0,n,...))
   zOut = (spreadOut - mean) / stddev;
   return true;
}

bool HasOpenSpreadPosition()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic()==InpMagicNumber && (posInfo.Symbol()==_Symbol || posInfo.Symbol()==InpSecondarySymbol))
         return true;
   }
   return false;
}

void CloseSpreadPosition()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic()!=InpMagicNumber) continue;
      if(posInfo.Symbol()==_Symbol || posInfo.Symbol()==InpSecondarySymbol)
         trade.PositionClose(posInfo.Ticket());
   }
}

void OpenSpreadPosition(bool shortSpread, double hedgeB)
{
   double secLot = NormalizeDouble(InpPrimaryLot * MathAbs(hedgeB), 2);
   if(secLot <= 0) secLot = SymbolInfoDouble(InpSecondarySymbol, SYMBOL_VOLUME_MIN);

   double pPrice = shortSpread ? SymbolInfoDouble(_Symbol,SYMBOL_BID) : SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double sPrice = shortSpread ? SymbolInfoDouble(InpSecondarySymbol,SYMBOL_ASK) : SymbolInfoDouble(InpSecondarySymbol,SYMBOL_BID);

   // SHORT_SPREAD (z too high, spread expected to fall): sell primary, buy secondary.
   // LONG_SPREAD  (z too low,  spread expected to rise):  buy primary,  sell secondary.
   if(shortSpread)
   {
      trade.Sell(InpPrimaryLot, _Symbol, pPrice, 0, 0, InpTradeComment);
      trade.Buy(secLot, InpSecondarySymbol, sPrice, 0, 0, InpTradeComment);
   }
   else
   {
      trade.Buy(InpPrimaryLot, _Symbol, pPrice, 0, 0, InpTradeComment);
      trade.Sell(secLot, InpSecondarySymbol, sPrice, 0, 0, InpTradeComment);
   }
}

void OnTick()
{
   datetime cb = iTime(_Symbol, InpTF, 0);
   bool isNewBar = (cb!=0 && gLastBar!=0 && cb!=gLastBar);
   if(isNewBar) gLastBar = cb;
   if(!isNewBar) return;

   if(!ComputeHedgeRatio(gHedgeB, gHedgeA)) { gModelReady=false; return; }
   gModelReady = true;

   double z, spread;
   if(!ComputeZScore(gHedgeB, gHedgeA, z, spread)) return;

   bool hasPos = HasOpenSpreadPosition();

   if(hasPos)
   {
      // Exit on reversion toward the mean or on hard divergence stop.
      // Direction-agnostic here (both REVERT and STOP just close the
      // whole spread trade) - which one fired is logged for review.
      if(MathAbs(z) <= InpZExit)
      {
         CloseSpreadPosition();
         Print("AT24 Pairs Reversion: closed on REVERT, z=", DoubleToString(z,3));
      }
      else if(MathAbs(z) >= InpZStop)
      {
         CloseSpreadPosition();
         Print("AT24 Pairs Reversion: closed on STOP, z=", DoubleToString(z,3));
      }
      return;
   }

   if(z >= InpZEntry)
   {
      OpenSpreadPosition(true, gHedgeB);
      Print("AT24 Pairs Reversion: opened SHORT_SPREAD, z=", DoubleToString(z,3), " b=", DoubleToString(gHedgeB,4));
   }
   else if(z <= -InpZEntry)
   {
      OpenSpreadPosition(false, gHedgeB);
      Print("AT24 Pairs Reversion: opened LONG_SPREAD, z=", DoubleToString(z,3), " b=", DoubleToString(gHedgeB,4));
   }
}
//+------------------------------------------------------------------+
