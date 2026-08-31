import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccount, applyFill, markToMarket } from "../src/runtime/simulation/account-engine.js";

test("createAccount: balance/equity/freeMargin all start at initialBalance, everything else at 0", () => {
  const account = createAccount(10_000, 0);
  assert.equal(account.balance, 10_000);
  assert.equal(account.equity, 10_000);
  assert.equal(account.freeMargin, 10_000);
  assert.equal(account.realizedPnl, 0);
  assert.equal(account.fees, 0);
  assert.equal(account.unrealizedPnl, 0);
  assert.equal(account.margin, 0);
});

test("createAccount rejects a negative or non-finite initial balance", () => {
  assert.throws(() => createAccount(-1, 0));
  assert.throws(() => createAccount(Number.NaN, 0));
});

test("applyFill: a winning trade increases balance/equity/realizedPnl by grossPnl minus fee", () => {
  const account = createAccount(10_000, 0);
  const after = applyFill(account, 500, 5, 1);
  assert.equal(after.balance, 10_000 + 500 - 5);
  assert.equal(after.realizedPnl, 500);
  assert.equal(after.fees, 5);
  assert.equal(after.equity, after.balance); // unrealizedPnl still 0
});

test("applyFill: fees always accumulate, win or lose", () => {
  const account = createAccount(10_000, 0);
  const afterLoss = applyFill(account, -200, 3, 1);
  assert.equal(afterLoss.balance, 10_000 - 200 - 3);
  assert.equal(afterLoss.fees, 3);
});

test("applyFill accumulates across repeated calls (accounting identity: balance = initial + sum(grossPnl) - sum(fees))", () => {
  let account = createAccount(10_000, 0);
  account = applyFill(account, 100, 1, 1);
  account = applyFill(account, -50, 1, 2);
  account = applyFill(account, 200, 1, 3);
  assert.equal(account.balance, 10_000 + 100 - 50 + 200 - 3);
  assert.equal(account.realizedPnl, 250);
  assert.equal(account.fees, 3);
});

test("markToMarket updates equity/freeMargin from balance + unrealizedPnl, never touches balance/realizedPnl/fees", () => {
  const account = applyFill(createAccount(10_000, 0), 100, 1, 1);
  const marked = markToMarket(account, 250, 2);
  assert.equal(marked.unrealizedPnl, 250);
  assert.equal(marked.equity, marked.balance + 250);
  assert.equal(marked.balance, account.balance);
  assert.equal(marked.realizedPnl, account.realizedPnl);
  assert.equal(marked.fees, account.fees);
});

test("markToMarket with a negative unrealizedPnl correctly reduces equity below balance", () => {
  const account = createAccount(10_000, 0);
  const marked = markToMarket(account, -300, 1);
  assert.equal(marked.equity, 9_700);
});

test("accounts are never mutated by either function (immutability)", () => {
  const account = createAccount(10_000, 0);
  const snapshot = JSON.stringify(account);
  applyFill(account, 100, 1, 1);
  markToMarket(account, 100, 1);
  assert.equal(JSON.stringify(account), snapshot);
});
