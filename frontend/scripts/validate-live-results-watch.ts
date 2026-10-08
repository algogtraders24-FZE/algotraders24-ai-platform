// Validates when a watcher is told that a page stopped reporting / is back. Pure.
import assert from "node:assert/strict";
import { watchDecision, watchMessage, WATCH_KIND_RESUMED, WATCH_KIND_STALE, WATCH_MIN_GAP_MS, WATCH_STALE_AFTER_MS } from "../services/live-results/watch-rules";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const NOW = Date.UTC(2026, 9, 8, 15, 0, 0);
const MIN = 60_000, H = 60 * MIN;
const base = { followedAt: NOW - 24 * H, nowUtc: NOW };

// reporting normally
eq(watchDecision({ ...base, lastSyncAt: NOW - 1 * MIN, last: null }), "none", "fresh data, nothing sent before -> nothing");
// goes quiet after they started watching
eq(watchDecision({ ...base, lastSyncAt: NOW - 11 * MIN, last: null }), "stopped", "quiet for 11 min after the watch began -> 'stopped'");
eq(watchDecision({ ...base, lastSyncAt: NOW - (WATCH_STALE_AFTER_MS / MIN - 1) * MIN, last: null }), "none", "9 minutes of silence is not an outage yet");
eq(watchDecision({ ...base, lastSyncAt: NOW - WATCH_STALE_AFTER_MS, last: null }), "stopped", "exactly the threshold counts as stopped");
// one message per outage
eq(watchDecision({ ...base, lastSyncAt: NOW - 3 * H, last: { kind: WATCH_KIND_STALE, at: NOW - 2 * H } }), "none", "already told about this outage -> quiet");
// back again
eq(watchDecision({ ...base, lastSyncAt: NOW - 1 * MIN, last: { kind: WATCH_KIND_STALE, at: NOW - 2 * H } }), "resumed", "after a 'stopped' notice, new data -> 'resumed' once");
eq(watchDecision({ ...base, lastSyncAt: NOW - 1 * MIN, last: { kind: WATCH_KIND_RESUMED, at: NOW - 2 * H } }), "none", "already told it is back -> quiet");
// the next outage after a 'resumed' notice
eq(watchDecision({ ...base, lastSyncAt: NOW - 30 * MIN, last: { kind: WATCH_KIND_RESUMED, at: NOW - 3 * H } }), "stopped", "a new outage after 'resumed' -> 'stopped' again");
// not a change from the watcher's point of view
eq(watchDecision({ followedAt: NOW - 1 * H, nowUtc: NOW, lastSyncAt: NOW - 5 * H, last: null }), "none", "page was already quiet before they started watching -> no notice");
eq(watchDecision({ followedAt: NOW - 1 * H, nowUtc: NOW, lastSyncAt: NOW - 30 * MIN, last: null }), "stopped", "went quiet after they started watching -> notice");
// flapping cannot spam the bell
eq(watchDecision({ ...base, lastSyncAt: NOW - 20 * MIN, last: { kind: WATCH_KIND_RESUMED, at: NOW - 10 * MIN } }), "none", "within the minimum gap nothing is sent");
eq(watchDecision({ ...base, lastSyncAt: NOW - 1 * MIN, last: { kind: WATCH_KIND_STALE, at: NOW - 10 * MIN } }), "resumed", "recovery is announced right away, even minutes after the 'stopped' notice");
eq(watchDecision({ ...base, lastSyncAt: NOW - 20 * MIN, last: { kind: WATCH_KIND_RESUMED, at: NOW - WATCH_MIN_GAP_MS - MIN } }), "stopped", "a new outage after the gap is announced");

// messages
const s = watchMessage("stopped", "XXXUS30", 42);
ok(s.title === "XXXUS30 stopped reporting" && s.severity === "warning" && /42 minutes/.test(s.body), "stopped message names the page and the quiet time");
const r = watchMessage("resumed", "XXXUS30", 0);
ok(r.title === "XXXUS30 is reporting again" && r.severity === "info", "resumed message");
ok(!/USD|\$|profit|balance/i.test(s.body + r.body), "messages carry no money or performance");

console.log(`validate-live-results-watch: ${checks} checks passed`);
