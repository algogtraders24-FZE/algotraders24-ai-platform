// scripts/validate-metaapi-rules.ts - unit checks for the order rules of the MetaApi integration (no network). Run: npx tsx scripts/validate-metaapi-rules.ts
import { isLiveAccount, maskLogin, tradeSucceeded, validateOrder, type OrderRequest } from "../lib/broker/order-rules";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { if (ok) { pass++; console.log("  ok -", name); } else { fail++; console.log("  FAIL -", name); } };

const base: OrderRequest = { symbol: "BTCUSD", side: "buy", kind: "limit", volume: 0.01, price: 59556, stopLoss: 58943, takeProfit: 60782 };
check("a valid buy limit passes", validateOrder(base, 0.1) === null);
check("a valid sell market (stop above, target below) passes", validateOrder({ ...base, side: "sell", kind: "market", price: undefined, stopLoss: 61000, takeProfit: 59000 }, 0.1) === null);
check("a stop loss is mandatory", validateOrder({ ...base, stopLoss: undefined }, 0.1) !== null);
check("volume above the cap is refused", validateOrder({ ...base, volume: 0.5 }, 0.1) !== null);
check("volume below 0.01 is refused", validateOrder({ ...base, volume: 0.001 }, 0.1) !== null);
check("volume with 3 decimals is refused", validateOrder({ ...base, volume: 0.015 }, 0.1) !== null);
check("a buy with the stop above the entry is refused", validateOrder({ ...base, stopLoss: 60000 }, 0.1) !== null);
check("a buy with the target below the entry is refused", validateOrder({ ...base, takeProfit: 59000 }, 0.1) !== null);
check("a sell limit with the stop below the entry is refused", validateOrder({ ...base, side: "sell", stopLoss: 58000, takeProfit: 58500 }, 0.1) !== null);
check("a limit order needs a price", validateOrder({ ...base, price: undefined }, 0.1) !== null);
check("a market buy with the target below the stop is refused", validateOrder({ ...base, kind: "market", price: undefined, stopLoss: 59000, takeProfit: 58000 }, 0.1) !== null);
check("a symbol with spaces or injection characters is refused", validateOrder({ ...base, symbol: "BTC USD;rm" }, 0.1) !== null);
check("NaN and negative numbers are refused", validateOrder({ ...base, stopLoss: Number.NaN }, 0.1) !== null && validateOrder({ ...base, takeProfit: -5 }, 0.1) !== null);
check("demo account is recognised", isLiveAccount({ type: "ACCOUNT_TRADE_MODE_DEMO" }) === false);
check("real account is live", isLiveAccount({ type: "ACCOUNT_TRADE_MODE_REAL" }) === true);
check("an unknown account type counts as live (safe default)", isLiveAccount({}) === true && isLiveAccount({ type: "" }) === true);
check("retcode 10009 and 10008 succeed, 10006 does not", tradeSucceeded({ numericCode: 10009 }) && tradeSucceeded({ stringCode: "TRADE_RETCODE_PLACED" }) && !tradeSucceeded({ numericCode: 10006, stringCode: "TRADE_RETCODE_REJECT" }));
check("the login is masked", maskLogin(412189535) === "••••535" && maskLogin("12") === "••••" && !maskLogin(412189535).includes("4121"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
