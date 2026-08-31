import { test } from "node:test";
import assert from "node:assert/strict";
import { EventQueue } from "../src/runtime/simulation/event-queue.js";

test("enqueue/dequeue respects timestamp ASC ordering", () => {
  const q = new EventQueue();
  q.enqueue({ timestamp: 30, eventType: "MARKET_BAR", source: "test", payload: null });
  q.enqueue({ timestamp: 10, eventType: "MARKET_BAR", source: "test", payload: null });
  q.enqueue({ timestamp: 20, eventType: "MARKET_BAR", source: "test", payload: null });
  assert.deepEqual([q.dequeue()!.timestamp, q.dequeue()!.timestamp, q.dequeue()!.timestamp], [10, 20, 30]);
});

test("stable FIFO for identical timestamps (sequence ASC tiebreak)", () => {
  const q = new EventQueue();
  const a = q.enqueue({ timestamp: 5, eventType: "MARKET_BAR", source: "test", payload: "a" });
  const b = q.enqueue({ timestamp: 5, eventType: "MARKET_BAR", source: "test", payload: "b" });
  const c = q.enqueue({ timestamp: 5, eventType: "MARKET_BAR", source: "test", payload: "c" });
  assert.deepEqual(
    [q.dequeue()!.payload, q.dequeue()!.payload, q.dequeue()!.payload],
    ["a", "b", "c"],
  );
  assert.deepEqual([a.sequence, b.sequence, c.sequence], [0, 1, 2]);
});

test("sequence is assigned by the queue, never the caller, and is monotonically increasing", () => {
  const q = new EventQueue();
  const first = q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "test", payload: null });
  const second = q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "test", payload: null });
  assert.ok(second.sequence > first.sequence);
});

test("eventId is deterministic: eventType:timestamp:sequence, no random component", () => {
  const q = new EventQueue();
  const evt = q.enqueue({ timestamp: 42, eventType: "ORDER_FILLED", source: "test", payload: null });
  assert.equal(evt.eventId, `ORDER_FILLED:42:${evt.sequence}`);
});

test("peek does not remove the event", () => {
  const q = new EventQueue();
  q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "test", payload: "x" });
  const peeked = q.peek();
  assert.equal(peeked?.payload, "x");
  assert.equal(q.size(), 1);
  assert.equal(q.dequeue()?.payload, "x");
});

test("isEmpty/size reflect queue contents", () => {
  const q = new EventQueue();
  assert.equal(q.isEmpty(), true);
  assert.equal(q.size(), 0);
  q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "test", payload: null });
  assert.equal(q.isEmpty(), false);
  assert.equal(q.size(), 1);
});

test("dequeue on an empty queue returns undefined, not an error", () => {
  const q = new EventQueue();
  assert.equal(q.dequeue(), undefined);
});

test("clear() empties the queue and resets the sequence counter", () => {
  const q = new EventQueue();
  q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "test", payload: null });
  q.enqueue({ timestamp: 2, eventType: "MARKET_BAR", source: "test", payload: null });
  q.clear();
  assert.equal(q.isEmpty(), true);
  const evt = q.enqueue({ timestamp: 1, eventType: "MARKET_BAR", source: "test", payload: null });
  assert.equal(evt.sequence, 0);
});

test("an invalid (non-finite) timestamp is rejected explicitly, not silently accepted", () => {
  const q = new EventQueue();
  assert.throws(() => q.enqueue({ timestamp: Number.NaN, eventType: "MARKET_BAR", source: "test", payload: null }));
  assert.throws(() => q.enqueue({ timestamp: Number.POSITIVE_INFINITY, eventType: "MARKET_BAR", source: "test", payload: null }));
});

test("many events across randomized-looking timestamps still dequeue in strict sorted order", () => {
  const q = new EventQueue();
  const timestamps = [50, 10, 40, 20, 5, 100, 15, 30, 5, 5];
  for (const t of timestamps) q.enqueue({ timestamp: t, eventType: "MARKET_BAR", source: "test", payload: null });
  const dequeued: number[] = [];
  while (!q.isEmpty()) dequeued.push(q.dequeue()!.timestamp);
  const sorted = [...timestamps].sort((a, b) => a - b);
  assert.deepEqual(dequeued, sorted);
});

test("repeated identical enqueue sequences produce identical dequeue order across two fresh queues (determinism)", () => {
  const build = () => {
    const q = new EventQueue();
    for (const t of [3, 1, 2, 1, 3]) q.enqueue({ timestamp: t, eventType: "MARKET_BAR", source: "test", payload: null });
    const out: string[] = [];
    while (!q.isEmpty()) out.push(q.dequeue()!.eventId);
    return out;
  };
  assert.deepEqual(build(), build());
});
