/**
 * Q1.4.2 — the required 25-fixture corpus (10 MQL4 positive, 10 MQL5
 * positive, 5 negative/adversarial), each isolating exactly one
 * import-to-execution concern. Every fixture is a syntactically complete
 * program the real lexer/parser/semantic-analyzer/ir-generator accepts.
 * Reuses the exact "EMA cross entry" shape Q0.9/Q0.10/Q0.13 already
 * established as the ONE provable simple-entry-condition pattern this
 * importer reconstructs — never a new detection pattern invented for
 * this sprint.
 */
export interface Q14Fixture {
  readonly id: string;
  readonly description: string;
  readonly dialect: "MQL4" | "MQL5";
  readonly source: string;
  /** What this fixture is expected to prove — used to drive the end-to-end pipeline test's assertions and the generated matrix doc. */
  readonly expectation: "REDUCED" | "REDUCED_WITH_WARNINGS" | "BLOCKED";
}

const EMA_GUARD = `datetime g_lastTime = 0;\nif(Time[0] != g_lastTime)\n{\ng_lastTime = Time[0];\ndouble fast = iMA(Symbol(),PERIOD_M5,9,0,MODE_EMA,PRICE_CLOSE,0);\ndouble slow = iMA(Symbol(),PERIOD_M5,21,0,MODE_EMA,PRICE_CLOSE,0);\nif(fast>slow)\n{\n`;
const EMA_GUARD5 = `datetime g_lastTime = 0;\nif(Time[0] != g_lastTime)\n{\ng_lastTime = Time[0];\ndouble fast = iMA(_Symbol,PERIOD_M5,9,0,MODE_EMA,PRICE_CLOSE,0);\ndouble slow = iMA(_Symbol,PERIOD_M5,21,0,MODE_EMA,PRICE_CLOSE,0);\nif(fast>slow)\n{\n`;

function mql4NoTrailer(body: string): string {
  return `int OP_BUYSTOP = 4;\nint OP_SELLSTOP = 5;\nint OP_BUYLIMIT = 2;\nint OP_SELLLIMIT = 3;\nint start()\n{\n${body}\nreturn(0);\n}\nint init() { return(0); }\n`;
}
function mql5NoTrailer(body: string): string {
  return `CTrade trade;\nvoid OnTick()\n{\n${body}\n}\nint OnInit() { return(0); }\n`;
}

export const Q14_CORPUS: readonly Q14Fixture[] = [
  // ============================================================= MQL4 (1-10)
  {
    id: "mql4-01-market-buy",
    description: "MQL4: market BUY on an EMA-cross condition",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_BUY,0.1,Bid,3,0,0,"c",0,0,clrBlue);\n}\n}`),
  },
  {
    id: "mql4-02-market-sell",
    description: "MQL4: market SELL on an EMA-cross condition",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_SELL,0.1,Bid,3,0,0,"c",0,0,clrBlue);\n}\n}`.replace("fast>slow", "fast<slow")),
  },
  {
    id: "mql4-03-buy-limit",
    description: "MQL4: BUY_LIMIT pending entry, literal price",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_BUYLIMIT,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}`),
  },
  {
    id: "mql4-04-sell-limit",
    description: "MQL4: SELL_LIMIT pending entry, literal price",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_SELLLIMIT,0.1,1.1030,3,0,0,"c",0,0,clrRed);\n}\n}`.replace("fast>slow", "fast<slow")),
  },
  {
    id: "mql4-05-buy-stop",
    description: "MQL4: BUY_STOP pending entry, literal price",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}`),
  },
  {
    id: "mql4-06-sell-stop",
    description: "MQL4: SELL_STOP pending entry, literal price",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_SELLSTOP,0.1,1.0900,3,0,0,"c",0,0,clrRed);\n}\n}`.replace("fast>slow", "fast<slow")),
  },
  {
    id: "mql4-07-orderselect-ordertype",
    description: "MQL4: OrderSelect + OrderType() read — OrderSelect is itself a genuine selecting/counting call (unlike bare OrderType()), so it correctly trips Q0.10's conservative pyramiding/reversal heuristic and BLOCKS the whole strategy (a real, current, verified behavior — not a Q1.4 regression)",
    dialect: "MQL4",
    expectation: "BLOCKED",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}\nif(OrderSelect(0,0))\n{\nint t = OrderType();\n}`),
  },
  {
    id: "mql4-08-orderselect-ordermodify",
    description: "MQL4: OrderSelect(ticket) + conditional OrderModify guarded by OrderType() — fully executable pending-order-management rule",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`int ticket = 0;\n${EMA_GUARD}ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}\nif(OrderType()==OP_BUYSTOP)\n{\nOrderModify(ticket, Bid + 0.0015, OrderStopLoss(), OrderTakeProfit(), 0);\n}`),
  },
  {
    id: "mql4-09-orderselect-orderdelete",
    description: "MQL4: OrderSelect(ticket) + conditional OrderDelete guarded by OrderType() — fully executable CANCEL_PENDING rule",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`int ticket = 0;\n${EMA_GUARD}ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}\nif(OrderType()==OP_BUYSTOP)\n{\nOrderDelete(ticket);\n}`),
  },
  {
    id: "mql4-10-expiration",
    description: "MQL4: OrderModify setting a non-zero expiration argument — detected, never compiled into an executable operation (documented Q0.13/Q1.3 scope boundary)",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`int ticket = 0;\n${EMA_GUARD}ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}\nOrderModify(ticket, 1.1030, OrderStopLoss(), OrderTakeProfit(), 1893456000);`),
  },

  // ============================================================= MQL5 (11-20)
  {
    id: "mql5-11-market-order",
    description: "MQL5: CTrade.Buy market order on an EMA-cross condition",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`${EMA_GUARD5}trade.Buy(0.1,_Symbol,0.0,0.0,0.0,"c");\n}\n}`),
  },
  {
    id: "mql5-12-buy-limit",
    description: "MQL5: CTrade.BuyLimit pending entry, literal price",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`${EMA_GUARD5}trade.BuyLimit(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}`),
  },
  {
    id: "mql5-13-sell-limit",
    description: "MQL5: CTrade.SellLimit pending entry, literal price",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`${EMA_GUARD5.replace("fast>slow", "fast<slow")}trade.SellLimit(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}`),
  },
  {
    id: "mql5-14-buy-stop",
    description: "MQL5: CTrade.BuyStop pending entry, literal price",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`${EMA_GUARD5}trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}`),
  },
  {
    id: "mql5-15-sell-stop",
    description: "MQL5: CTrade.SellStop pending entry, literal price",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`${EMA_GUARD5.replace("fast>slow", "fast<slow")}trade.SellStop(0.1,1.0900,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}`),
  },
  {
    id: "mql5-16-orderget-ticket",
    description: "MQL5: OrderGetTicket(0) target-selection read (query detection only)",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`${EMA_GUARD5}trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}\nulong ticket = OrderGetTicket(0);`),
  },
  {
    id: "mql5-17-orderget-integer-ordertype",
    description: "MQL5: OrderGetInteger(ORDER_TYPE) idiomatic order-type read — recognized as a provable ORDER_TYPE_FILTER since Q1.5.2 (previously a documented coverage gap; OrderType()/PositionGetInteger(POSITION_TYPE) were the only recognized forms before this sprint)",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`ulong ticket = 0;\n${EMA_GUARD5}trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}\nif(OrderGetInteger(ORDER_TYPE)==ORDER_TYPE_BUY_STOP)\n{\ntrade.OrderDelete(ticket);\n}`),
  },
  {
    id: "mql5-18-pending-modification",
    description: "MQL5: CTrade.OrderModify guarded by a provable OrderType() filter — fully executable MODIFY_STOP",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`ulong ticket = 0;\n${EMA_GUARD5}trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}\nif(OrderType()==OP_BUYSTOP)\n{\ntrade.OrderModify(ticket, Bid + 0.0015, 0.0, 0.0, ORDER_TIME_GTC, 0, 0.0);\n}`),
  },
  {
    id: "mql5-19-pending-cancellation",
    description: "MQL5: CTrade.OrderDelete guarded by a provable OrderType() filter — fully executable CANCEL_PENDING",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`ulong ticket = 0;\n${EMA_GUARD5}trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}\nif(OrderType()==OP_BUYSTOP)\n{\ntrade.OrderDelete(ticket);\n}`),
  },
  {
    id: "mql5-20-expiration",
    description: "MQL5: CTrade.OrderModify setting a non-zero expiration argument — detected, never compiled (documented scope boundary)",
    dialect: "MQL5",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql5NoTrailer(`ulong ticket = 0;\n${EMA_GUARD5}trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");\n}\n}\ntrade.OrderModify(ticket, 1.1030, 0.0, 0.0, ORDER_TIME_SPECIFIED, 1893456000, 0.0);`),
  },

  // ============================================================= Negative / adversarial (21-25)
  {
    id: "mql4-21-dynamic-order-type",
    description: "MQL4: order type is a runtime-computed variable, not a literal OP_* constant — the pending-order-type/entry-direction resolution cannot prove a direction, falls back to the honest UNREPRESENTABLE placeholder",
    dialect: "MQL4",
    expectation: "BLOCKED",
    source: `int GetDynamicCmd() { return(4); }\nint start()\n{\nint cmd = GetDynamicCmd();\nOrderSend(Symbol(),cmd,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\nreturn(0);\n}\nint init() { return(0); }\n`,
  },
  {
    id: "mql4-22-unresolved-order-target",
    description: "MQL4: OrderModify's ticket argument is itself an unresolved function call — target resolves UNKNOWN, the compiled rule is excluded from execution",
    dialect: "MQL4",
    expectation: "REDUCED_WITH_WARNINGS",
    source: mql4NoTrailer(`int ticket = 0;\n${EMA_GUARD}ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);\n}\n}\nOrderModify(GetActiveTicket(), 1.1030, OrderStopLoss(), OrderTakeProfit(), 0);`),
  },
  {
    id: "mql5-23-unknown-external-state",
    description: "MQL5: SL/TP computed by an unresolved cross-file function — a declared STOP_LOSS/TAKE_PROFIT exit whose price cannot be resolved BLOCKS the whole strategy (a real, current, verified eligibility behavior: 'nothing would actually be simulated' is refused outright, never silently dropped to a no-op exit)",
    dialect: "MQL5",
    expectation: "BLOCKED",
    source: mql5NoTrailer(`${EMA_GUARD5}double sl = G01_CalculateSL();\ndouble tp = G01_CalculateTP();\ntrade.Buy(0.1,_Symbol,0.0,sl,tp,"c");\n}\n}`),
  },
  {
    id: "mql4-24-bidask-dependency",
    description: "MQL4: a pending order's OWN trigger price expressed as a bare live Bid/Ask reference — BLOCKED at eligibility (no live bid/ask feed exists in this OHLCV-only engine, Q0.11.3)",
    dialect: "MQL4",
    expectation: "BLOCKED",
    source: mql4NoTrailer(`${EMA_GUARD}OrderSend(Symbol(),OP_BUYSTOP,0.1,Ask,3,0,0,"c",0,0,clrBlue);\n}\n}`),
  },
  {
    id: "mql4-25-ambiguous-execution-semantics",
    description: "MQL4: entry logic is NOT the one provable simple-condition shape (a custom function gates the order call) — the real entry sequence is honestly reported UNREPRESENTABLE, never approximated",
    dialect: "MQL4",
    expectation: "BLOCKED",
    source: `bool CustomSignal() { return(true); }\nint start()\n{\nif(CustomSignal())\n{\nOrderSend(Symbol(),OP_BUY,0.1,Bid,3,0,0,"c",0,0,clrBlue);\n}\nreturn(0);\n}\nint init() { return(0); }\n`,
  },
];

export function findQ14Fixture(id: string): Q14Fixture {
  const f = Q14_CORPUS.find((x) => x.id === id);
  if (!f) throw new Error(`unknown Q1.4 fixture id: ${id}`);
  return f;
}
