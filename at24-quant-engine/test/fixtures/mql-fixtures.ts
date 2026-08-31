import type { MQLImportOptions } from "../../src/runtime/mql-importer/ir-generator.js";
import type { Instrument, Timeframe } from "../../src/domain/market-data.js";

export const MQL_FIXTURE_INSTRUMENT: Instrument = { symbol: "EURUSD" };
export const MQL_FIXTURE_TIMEFRAME: Timeframe = "M5";

export function baseOptions(overrides: Partial<MQLImportOptions> = {}): MQLImportOptions {
  return {
    strategyId: "mql-fixture",
    strategyVersion: "1.0.0",
    instrument: MQL_FIXTURE_INSTRUMENT,
    executionTimeframe: MQL_FIXTURE_TIMEFRAME,
    importedAt: 0,
    ...overrides,
  };
}

/** Q0.8.47 — 26 minimum golden MQL source fixtures. Each is a small, self-contained, syntactically valid MQL snippet exercising exactly one concept. */
export const MQL_GOLDEN_FIXTURES: Readonly<Record<string, string>> = {
  // 1. SMA crossover (MQL4-style direct indicator read)
  smaCrossover: `
    void OnTick()
      {
       double fast = iMA(_Symbol,PERIOD_M5,9,0,MODE_SMA,PRICE_CLOSE,0);
       double slow = iMA(_Symbol,PERIOD_M5,21,0,MODE_SMA,PRICE_CLOSE,0);
       if(fast>slow) { }
      }
  `,
  // 2. EMA crossover (provable cross pattern)
  emaCrossover: `
    void OnTick()
      {
       if(Fast[1]<=Slow[1] && Fast[0]>Slow[0]) { }
      }
  `,
  // 3. RSI
  rsi: `
    void OnTick()
      {
       double r = iRSI(_Symbol,PERIOD_M5,14,PRICE_CLOSE,0);
       if(r<30) { }
      }
  `,
  // 4. ATR SL
  atrSL: `
    input double InpSLBufferATRMultiple = 1.5;
    void OnTick()
      {
       double atr = iATR(_Symbol,PERIOD_M5,14,0);
       double sl = Bid - atr*InpSLBufferATRMultiple;
      }
  `,
  // 5. ATR TP
  atrTP: `
    input double InpTP_RMultiple = 2.0;
    void OnTick()
      {
       double atr = iATR(_Symbol,PERIOD_M5,14,0);
       double tp = Bid + atr*InpTP_RMultiple;
      }
  `,
  // 6. Fixed SL/TP
  fixedSLTP: `
    void OnTick()
      {
       double sl = Bid - 0.0050;
       double tp = Bid + 0.0100;
      }
  `,
  // 7. Market BUY
  marketBuy: `
    CTrade g_trade;
    void OnTick()
      {
       g_trade.Buy(0.1,_Symbol,0.0,0.0,0.0,"buy");
      }
  `,
  // 8. Market SELL
  marketSell: `
    CTrade g_trade;
    void OnTick()
      {
       g_trade.Sell(0.1,_Symbol,0.0,0.0,0.0,"sell");
      }
  `,
  // 9. Limit order
  limitOrder: `
    void OnTick()
      {
       int ticket = OrderSend(_Symbol,OP_BUYLIMIT,0.1,Bid-0.0010,3,0,0,"limit",0,0,clrBlue);
      }
  `,
  // 10. Stop order
  stopOrder: `
    void OnTick()
      {
       int ticket = OrderSend(_Symbol,OP_BUYSTOP,0.1,Ask+0.0010,3,0,0,"stop",0,0,clrBlue);
      }
  `,
  // 11. Trailing
  trailing: `
    void OnTick()
      {
       for(int i=OrdersTotal()-1; i>=0; i--)
         {
          if(OrderSelect(i,SELECT_BY_POS))
             OrderModify(OrderTicket(),OrderOpenPrice(),Bid-0.0020,OrderTakeProfit(),0,clrBlue);
         }
      }
  `,
  // 12. Breakeven
  breakeven: `
    input double InpBreakevenTrigger = 0.0030;
    void OnTick()
      {
       if(Bid-OrderOpenPrice() >= InpBreakevenTrigger)
          OrderModify(OrderTicket(),OrderOpenPrice(),OrderOpenPrice(),OrderTakeProfit(),0,clrBlue);
      }
  `,
  // 13. Partial close
  partialClose: `
    void OnTick()
      {
       OrderClose(OrderTicket(),0.05,Bid,3,clrRed);
      }
  `,
  // 14. Session
  session: `
    input int InpSessionStartHour = 8;
    input int InpSessionEndHour = 16;
    void OnTick()
      {
       MqlDateTime dt;
       TimeToStruct(TimeCurrent(),dt);
       if(dt.hour>=InpSessionStartHour && dt.hour<InpSessionEndHour) { }
      }
  `,
  // 15. MTF (H1 higher-timeframe filter for an M5 execution strategy)
  mtf: `
    void OnTick()
      {
       double h1Close = iClose(_Symbol,PERIOD_H1,1);
       double m5Close = iClose(_Symbol,PERIOD_M5,1);
       if(m5Close>h1Close) { }
      }
  `,
  // 16. Multi-symbol
  multiSymbol: `
    void OnTick()
      {
       double eur = iClose("EURUSD",PERIOD_M5,1);
       double gbp = iClose("GBPUSD",PERIOD_M5,1);
       if(eur>0 && gbp>0) { }
      }
  `,
  // 17. Netting (MT5 CTrade, single Buy/Sell per symbol, no explicit hedging setup)
  netting: `
    CTrade g_trade;
    void OnTick()
      {
       if(!PositionSelect(_Symbol))
          g_trade.Buy(0.1,_Symbol,0.0,0.0,0.0,"net");
      }
  `,
  // 18. Hedging (explicit magic-numbered multiple simultaneous tickets, MQL4-style)
  hedging: `
    void OnTick()
      {
       int ticket1 = OrderSend(_Symbol,OP_BUY,0.1,Ask,3,0,0,"a",111,0,clrBlue);
       int ticket2 = OrderSend(_Symbol,OP_SELL,0.1,Bid,3,0,0,"b",222,0,clrRed);
      }
  `,
  // 19. Reversal
  reversal: `
    CTrade g_trade;
    void OnTick()
      {
       if(PositionSelect(_Symbol))
         {
          g_trade.PositionClose(_Symbol);
          g_trade.Sell(0.1,_Symbol,0.0,0.0,0.0,"reverse");
         }
      }
  `,
  // 20. Dynamic (percent-equity-risk) sizing
  dynamicSizing: `
    input double InpRiskPercent = 1.0;
    void OnTick()
      {
       double equity = AccountInfoDouble(ACCOUNT_EQUITY);
       double lots = equity * InpRiskPercent / 100.0 / 1000.0;
      }
  `,
  // 21. iCustom (unsupported)
  iCustomIndicator: `
    void OnTick()
      {
       double v = iCustom(_Symbol,PERIOD_M5,"MyProprietaryIndicator",0,0);
      }
  `,
  // 22. DLL import (unsupported)
  dllImport: `
    #import "MyLibrary.dll"
    int MyFunction(int x);
    #import
    void OnTick()
      {
       int y = MyFunction(1);
      }
  `,
  // 23. WebRequest (unsupported)
  webRequest: `
    void OnTick()
      {
       char data[]; char result[]; string headers;
       int res = WebRequest("GET","http://example.com/signal",headers,1000,data,result,headers);
      }
  `,
  // 24. Repainting / current-bar dependent
  repaintingCurrentBar: `
    void OnTick()
      {
       double v = iCustom(_Symbol,PERIOD_M5,"RepaintingIndicator",0,0);
       if(v>0) { }
      }
  `,
  // 25. Future-shift rejection
  futureShiftRejection: `
    void OnTick()
      {
       double v = Close[-1];
      }
  `,
  // 26. G01 real EA — see test/mql-g01-import.test.ts, which reads the actual file directly.
};
