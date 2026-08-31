import type { OHLCVBar } from "../../src/domain/market-data.js";

/**
 * Q0.9 — dedicated end-to-end MQL source fixtures, one deliberately
 * SIMPLE enough (single provable entry condition, direction-symmetric
 * fixed-distance SL/TP) to actually clear the reduction eligibility gate
 * and run inside Q0.5's simulation engine. Q0.8's own 26 golden fixtures
 * (test/fixtures/mql-fixtures.ts) intentionally exercise DETECTION only
 * (most use placeholder bodies) — these two exist to prove the FULL
 * pipeline (source -> AST -> semantic model -> IR -> StrategySpec ->
 * simulation) at least once per dialect, which is Q0.9's own Critical
 * Success Criterion.
 */
export const MQL5_EMA_CROSS_FIXED_SLTP = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;

void OnTick()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
      if(fast>slow)
        {
         double sl = bid - 0.0050;
         double tp = bid + 0.0100;
         g_trade.Buy(0.1,_Symbol,0.0,sl,tp,"c");
        }
      else if(fast<slow)
        {
         double sl = bid + 0.0050;
         double tp = bid - 0.0100;
         g_trade.Sell(0.1,_Symbol,0.0,sl,tp,"c");
        }
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;

/** MQL4 equivalent of the fixture above — OrderSend-style, same strategy shape, for parity testing. */
export const MQL4_EMA_CROSS_FIXED_SLTP = `
extern int InpFastPeriod = 9;
extern int InpSlowPeriod = 21;
datetime g_lastTime = 0;

int start()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
        {
         double sl = Bid - 0.0050;
         double tp = Bid + 0.0100;
         OrderSend(Symbol(),OP_BUY,0.1,Ask,3,sl,tp,"c",0,0,clrBlue);
        }
      else if(fast<slow)
        {
         double sl = Bid + 0.0050;
         double tp = Bid - 0.0100;
         OrderSend(Symbol(),OP_SELL,0.1,Bid,3,sl,tp,"c",0,0,clrRed);
        }
     }
   return(0);
  }
int init() { return(0); }
`;

/** RSI-oversold-only pair (MQL5/MQL4), no SL/TP — proves an indicator-threshold condition (not just a crossover) also reduces cleanly. */
export const MQL5_RSI_OVERSOLD = `
input int InpRSIPeriod = 14;
datetime g_lastTime = 0;
CTrade g_trade;

void OnTick()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double rsi = iRSI(_Symbol,PERIOD_M5,InpRSIPeriod,PRICE_CLOSE,0);
      if(rsi<30)
         g_trade.Buy(0.1,_Symbol,0.0,0.0,0.0,"c");
     }
  }
int OnInit() { return(0); }
`;

export const MQL4_RSI_OVERSOLD = `
extern int InpRSIPeriod = 14;
datetime g_lastTime = 0;

int start()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double rsi = iRSI(Symbol(),PERIOD_M5,InpRSIPeriod,PRICE_CLOSE,0);
      if(rsi<30)
         OrderSend(Symbol(),OP_BUY,0.1,Ask,3,0,0,"c",0,0,clrBlue);
     }
   return(0);
  }
`;

/** Deterministic, FX-pip-scale synthetic OHLCV series (never a full-unit random walk — see Q0.9's warmup-fix investigation: tiny SL/TP distances require tiny bar-to-bar volatility, or a next-bar-open gap trivially blows through the stop). */
export function buildSyntheticFxBars(count = 120, symbol = "EURUSD", timeframe: OHLCVBar["timeframe"] = "M5"): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const base = Date.parse("2026-01-05T00:00:00Z");
  let price = 1.1;
  for (let i = 0; i < count; i++) {
    price += Math.sin(i / 8) * 0.0006 + 0.00002;
    const open = price;
    const close = price + Math.sin(i / 8 + 0.3) * 0.0002;
    bars.push({
      timestamp: base + i * 3_600_000,
      instrument: { symbol },
      timeframe,
      open,
      high: Math.max(open, close) + 0.0003,
      low: Math.min(open, close) - 0.0003,
      close,
      volume: 1000,
    });
  }
  return bars;
}
