/**
 * Q0.13.17 — 20 hand-authored MQL4/MQL5 fixtures (1-12 MQL4, 13-20 MQL5),
 * each isolating exactly ONE pending-order-management shape. Every
 * snippet is a syntactically complete, minimal MQL program the real
 * lexer/parser/semantic-analyzer accepts (no `#include`, no unresolved
 * dependency beyond what the fixture is deliberately testing).
 */
export interface Q13Fixture {
  readonly id: string;
  readonly description: string;
  readonly dialect: "MQL4" | "MQL5";
  readonly source: string;
}

function mql4(body: string): string {
  return `int OP_BUYSTOP = 4;\nint OP_SELLSTOP = 5;\nint OP_BUYLIMIT = 2;\nint OP_SELLLIMIT = 3;\nvoid start()\n{\n${body}\n}\nint init() { return(0); }\n`;
}

function mql5(body: string): string {
  return `CTrade trade;\nvoid OnTick()\n{\n${body}\n}\nint OnInit() { return(0); }\n`;
}

export const Q13_FIXTURES: readonly Q13Fixture[] = [
  // ---------------------------------------------------------------- MQL4
  {
    id: "mql4-01-modify-sl",
    description: "MQL4: unconditional OrderModify changing SL only (position-level ticket modify, price arg unchanged)",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nOrderModify(ticket, OrderOpenPrice(), OrderOpenPrice() - 0.0050, OrderTakeProfit(), 0);`),
  },
  {
    id: "mql4-02-modify-tp",
    description: "MQL4: unconditional OrderModify changing TP only",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nOrderModify(ticket, OrderOpenPrice(), OrderStopLoss(), OrderOpenPrice() + 0.0200, 0);`),
  },
  {
    id: "mql4-03-modify-sl-and-tp",
    description: "MQL4: unconditional OrderModify changing SL and TP together",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nOrderModify(ticket, OrderOpenPrice(), OrderOpenPrice() - 0.0050, OrderOpenPrice() + 0.0200, 0);`),
  },
  {
    id: "mql4-04-modify-expiration",
    description: "MQL4: OrderModify changing only the expiration argument (a non-zero literal)",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nOrderModify(ticket, OrderOpenPrice(), OrderStopLoss(), OrderTakeProfit(), 1893456000);`),
  },
  {
    id: "mql4-05-delete-pending-by-type",
    description: "MQL4: conditional OrderDelete guarded by a provable OrderType()==OP_BUYSTOP filter — fully executable CANCEL_PENDING",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nif(OrderType()==OP_BUYSTOP)\n{\nOrderDelete(ticket);\n}`),
  },
  {
    id: "mql4-06-conditional-modify-unresolvable-type",
    description: "MQL4: conditional OrderModify with a provable FAVORABLE_DISTANCE condition but an unresolvable target order type (LIMIT vs STOP) — condition preserved, operation stays UNKNOWN (never guessed)",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nif(Bid - OrderOpenPrice() >= 0.0030)\n{\nOrderModify(ticket, Bid + 0.0010, OrderStopLoss(), OrderTakeProfit(), 0);\n}`),
  },
  {
    id: "mql4-07-delete-pending-sellstop",
    description: "MQL4: conditional OrderDelete guarded by OrderType()==OP_SELLSTOP — the SELL-side mirror of fixture 5",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nif(OrderType()==OP_SELLSTOP)\n{\nOrderDelete(ticket);\n}`),
  },
  {
    id: "mql4-08-price-modification-executable",
    description: "MQL4: conditional OrderModify guarded by a provable order-type filter AND a resolvable price-distance binding — the ONE fully-executable MODIFY_STOP fixture",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nif(OrderType()==OP_BUYSTOP)\n{\nOrderModify(ticket, Bid + 0.0015, OrderStopLoss(), OrderTakeProfit(), 0);\n}`),
  },
  {
    id: "mql4-09-cancel-then-recreate",
    description: "MQL4: OrderDelete immediately followed by an unrelated OrderSend — must NEVER be fabricated into a REPLACE relationship (Q0.13.12/20)",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nOrderDelete(ticket);\nOrderSend(Symbol(), OP_BUYSTOP, 0.1, Ask + 0.0020, 3, 0, 0, "re", 0, 0, clrBlue);`),
  },
  {
    id: "mql4-10-unknown-ticket",
    description: "MQL4: OrderModify whose target argument is itself an unresolved function call — target correctly resolves to UNKNOWN, never guessed as 'current order'",
    dialect: "MQL4",
    source: mql4(`OrderModify(GetActiveTicket(), OrderOpenPrice(), OrderOpenPrice() - 0.0050, OrderTakeProfit(), 0);`),
  },
  {
    id: "mql4-11-unresolved-price-function",
    description: "MQL4: a provable order-type filter, but the new price comes from an unresolved cross-file function — operation stays UNKNOWN even with a good condition",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\nif(OrderType()==OP_BUYSTOP)\n{\nOrderModify(ticket, G01_CalcNewPrice(), OrderStopLoss(), OrderTakeProfit(), 0);\n}`),
  },
  {
    id: "mql4-12-unsupported-dynamic-expression",
    description: "MQL4: a provable order-type filter, but the new price is a dynamic product expression with no literal/ATR-multiple magnitude — operation stays UNKNOWN (never approximated)",
    dialect: "MQL4",
    source: mql4(`int ticket = 1;\ndouble volatilityMultiplier = 2.0;\nif(OrderType()==OP_BUYSTOP)\n{\nOrderModify(ticket, MarketInfo(Symbol(), 1) * volatilityMultiplier, OrderStopLoss(), OrderTakeProfit(), 0);\n}`),
  },

  // ---------------------------------------------------------------- MQL5
  {
    id: "mql5-13-ctrade-ordermodify-unconditional",
    description: "MQL5: unconditional CTrade.OrderModify — detected and distinguished from PositionModify, but not compiled (no order-type filter to resolve LIMIT vs STOP)",
    dialect: "MQL5",
    source: mql5(`ulong ticket = 1;\ntrade.OrderModify(ticket, 1.2000, 1.1950, 1.2100, ORDER_TIME_GTC, 0, 0.0);`),
  },
  {
    id: "mql5-14-ctrade-orderdelete-unconditional",
    description: "MQL5: unconditional CTrade.OrderDelete — a real, legitimate, fully-provable UNCONDITIONAL case, fully executable CANCEL_PENDING",
    dialect: "MQL5",
    source: mql5(`ulong ticket = 1;\ntrade.OrderDelete(ticket);`),
  },
  {
    id: "mql5-15-ctrade-positionmodify",
    description: "MQL5: CTrade.PositionModify — detected and recorded, but NEVER confused with OrderModify (Q0.13's own success criterion 5); not compiled into pending-order policy (Q0.10's own domain)",
    dialect: "MQL5",
    source: mql5(`double newSL = 1.1950;\ndouble tp = 1.2100;\ntrade.PositionModify(_Symbol, newSL, tp);`),
  },
  {
    id: "mql5-16-ctrade-positionclose",
    description: "MQL5: CTrade.PositionClose — detected and recorded, but NEVER confused with OrderDelete (Q0.13's own success criterion 6)",
    dialect: "MQL5",
    source: mql5(`trade.PositionClose(_Symbol);`),
  },
  {
    id: "mql5-17-conditional-positionmodify-condition-preserved",
    description: "MQL5: `if(newSL > currentSL) trade.PositionModify(...)` — the spec's own worked example; condition text preserved verbatim, honestly UNKNOWN (not one of the two provable shapes), never collapsed to a bare MOVE_STOP",
    dialect: "MQL5",
    source: mql5(`double newSL = 1.1950;\ndouble currentSL = 1.1900;\ndouble tp = 1.2100;\nif(newSL > currentSL)\n{\ntrade.PositionModify(_Symbol, newSL, tp);\n}`),
  },
  {
    id: "mql5-18-ctrade-ordermodify-executable",
    description: "MQL5: conditional CTrade.OrderModify guarded by a provable order-type filter AND a resolvable price-distance binding — fully executable MODIFY_STOP",
    dialect: "MQL5",
    source: mql5(`ulong ticket = 1;\ndouble sl = 1.1950;\ndouble tp = 1.2100;\nif(OrderType()==OP_BUYSTOP)\n{\ntrade.OrderModify(ticket, Bid + 0.0015, sl, tp, ORDER_TIME_GTC, 0, 0.0);\n}`),
  },
  {
    id: "mql5-19-ctrade-ordermodify-expiration-detected-not-compiled",
    description: "MQL5: CTrade.OrderModify changing only the expiration argument — detected (newExpirationExpr populated) but never compiled into an executable operation (a raw datetime is not reducible to Q0.12's bar-count-based OrderExpirationPolicy without knowing the timeframe duration — a documented Q0.14 boundary)",
    dialect: "MQL5",
    source: mql5(`ulong ticket = 1;\ndouble price = 1.2000;\ndouble sl = 1.1950;\ndouble tp = 1.2100;\ntrade.OrderModify(ticket, price, sl, tp, ORDER_TIME_SPECIFIED, 1893456000, 0.0);`),
  },
  {
    id: "mql5-20-unresolved-target",
    description: "MQL5: CTrade.OrderDelete whose ticket argument is itself an unresolved function call — target correctly resolves to UNKNOWN",
    dialect: "MQL5",
    source: mql5(`trade.OrderDelete(GetActiveTicket());`),
  },
];

export function findFixture(id: string): Q13Fixture {
  const f = Q13_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`unknown Q0.13 fixture id: ${id}`);
  return f;
}
