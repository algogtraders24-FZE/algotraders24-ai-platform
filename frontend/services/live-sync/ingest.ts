// services/live-sync/ingest.ts
// AT24 Live Sync (P1) - the ingest decision logic, pure over an injected store
// (so it is tested without a database). One call = one authenticated device's
// request for ONE account.
//
// Rules (fail closed, in order): strict schema -> account (per-user cap) ->
// hash recomputation -> chain position (duplicate / gap / fork) -> commit.
// Resending the same batch is harmless (idempotent); a missing batch is a gap the
// EA must fill; a different history at the same position is a fork and is refused.

import { LIMITS, ZERO_HASH, type WireAccountFacts, type WireDeal, type WireSnapshot } from "./contract";
import { computeBatchHash } from "./crypto";
import { validateIngestBody } from "./validate";

export interface AccountRow {
  id: string;
  chainSeq: number;
  chainHead: string;
  lastSnapshotAt: Date | null;
  /** Newest deal time (broker server ms) stored for this account, or null. */
  lastDealTimeMsc: number | null;
}

export interface CommitArgs {
  accountId: string;
  now: Date;
  facts: WireAccountFacts;
  chain?: { seq: number; prevHash: string; hash: string; deals: (WireDeal & { timeUtc: Date })[] };
  snapshot?: { timeUtc: Date; data: WireSnapshot };
}

export interface LiveSyncStore {
  getAccount(userId: string, accountKey: string): Promise<AccountRow | null>;
  countAccounts(userId: string): Promise<number>;
  createAccount(userId: string, accountKey: string, facts: WireAccountFacts, now: Date): Promise<AccountRow>;
  /** Atomically: insert deals (ignoring existing tickets), record the batch, advance the chain, store the snapshot, update account facts + lastSyncAt. */
  commit(args: CommitArgs): Promise<{ insertedDeals: number }>;
}

export type IngestErrorCode = "INVALID_SCHEMA" | "ACCOUNT_LIMIT" | "HASH_MISMATCH" | "SEQ_GAP" | "CHAIN_FORK";

export type IngestOutcome =
  | {
      ok: true;
      status: 200;
      /** Internal (not part of the HTTP body): lets the HTTP layer run post-ingest hooks such as alerts. */
      accountId: string;
      body: { ok: true; ackSeq: number; nextSeq: number; chainHead: string; duplicate: boolean; insertedDeals: number; snapshotStored: boolean; lastDealTimeMsc: number | null };
    }
  | { ok: false; status: 400 | 409 | 422; body: { ok: false; code: IngestErrorCode; message: string; expectedSeq?: number; chainHead?: string; lastDealTimeMsc?: number | null } };

const err = (status: 400 | 409 | 422, code: IngestErrorCode, message: string, extra: { expectedSeq?: number; chainHead?: string; lastDealTimeMsc?: number | null } = {}): IngestOutcome => ({
  ok: false,
  status,
  body: { ok: false, code, message, ...extra },
});

export async function processIngest(store: LiveSyncStore, userId: string, rawBody: unknown, now: Date): Promise<IngestOutcome> {
  const parsed = validateIngestBody(rawBody);
  if (!parsed.ok) return err(422, "INVALID_SCHEMA", parsed.message);
  const body = parsed.body;

  let account = await store.getAccount(userId, body.accountKey);
  if (!account) {
    if ((await store.countAccounts(userId)) >= LIMITS.maxAccountsPerUser) {
      return err(409, "ACCOUNT_LIMIT", `At most ${LIMITS.maxAccountsPerUser} accounts can be synced. Delete one in the dashboard first.`);
    }
    account = await store.createAccount(userId, body.accountKey, body.account, now);
  }

  const offsetMs = body.account.serverUtcOffsetSec * 1000;
  let chain: CommitArgs["chain"];
  let duplicate = false;

  if (body.deals.length > 0) {
    const seq = body.seq!;
    const prevHash = body.prevHash!;
    const hash = body.hash!;
    if (computeBatchHash(prevHash, seq, body.deals) !== hash) {
      return err(400, "HASH_MISMATCH", "The batch hash does not match its contents.");
    }
    if (seq === account.chainSeq && hash === account.chainHead) {
      duplicate = true; // the exact batch we already hold: acknowledge, write nothing
    } else if (seq !== account.chainSeq + 1) {
      return err(409, "SEQ_GAP", "Batch out of order.", { expectedSeq: account.chainSeq + 1, chainHead: account.chainHead, lastDealTimeMsc: account.lastDealTimeMsc });
    } else if (prevHash !== account.chainHead) {
      return err(409, "CHAIN_FORK", "The batch does not continue the stored history.", { expectedSeq: account.chainSeq + 1, chainHead: account.chainHead, lastDealTimeMsc: account.lastDealTimeMsc });
    } else {
      chain = { seq, prevHash, hash, deals: body.deals.map((d) => ({ ...d, timeUtc: new Date(d.timeMsc - offsetMs) })) };
    }
  }

  let snapshot: CommitArgs["snapshot"];
  if (body.snapshot) {
    const tooSoon = account.lastSnapshotAt !== null && now.getTime() - account.lastSnapshotAt.getTime() < LIMITS.minSnapshotIntervalSec * 1000;
    if (!tooSoon) snapshot = { timeUtc: new Date(body.snapshot.timeMsc - offsetMs), data: body.snapshot };
  }

  const { insertedDeals } = await store.commit({ accountId: account.id, now, facts: body.account, chain, snapshot });
  const seqNow = chain ? chain.seq : account.chainSeq;
  const headNow = chain ? chain.hash : account.chainHead;
  const lastDealNow = chain ? Math.max(account.lastDealTimeMsc ?? 0, ...chain.deals.map((d) => d.timeMsc)) : account.lastDealTimeMsc;
  return {
    ok: true,
    status: 200,
    accountId: account.id,
    body: { ok: true, ackSeq: seqNow, nextSeq: seqNow + 1, chainHead: headNow || ZERO_HASH, duplicate, insertedDeals, snapshotStored: snapshot !== undefined, lastDealTimeMsc: lastDealNow },
  };
}
