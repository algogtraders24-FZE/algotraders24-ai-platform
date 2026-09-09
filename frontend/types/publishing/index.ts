// types/publishing/index.ts
// AT24 Publishing Contract - the single import surface (Sprint P2.1).
//
// Everything re-exported here is a PURE declarative contract: shapes, closed
// vocabularies, deterministic state-transition tables and pure validation
// predicates. No runtime behavior lives under types/publishing/ (see
// common.ts). The one runtime helper the contract needs - the sha256 digest
// for contentHash - lives in services/publishing/content-hash.ts, NOT here.
//
// This module does NOT depend on types/agent-framework/ or
// services/agent-framework/ (Sprint P2.1 §17).
//
// CONTRACT VERSION is bumped only on a breaking change to an exported shape,
// vocabulary, transition table, or the content-hash algorithm. Appending a
// new optional field, a new destination, or a new enum member does NOT bump
// it.

export const PUBLISHING_CONTRACT_VERSION = "PUB-v1" as const;
export type PublishingContractVersion = typeof PUBLISHING_CONTRACT_VERSION;

export * from "./common";
export * from "./destination-contract";
export * from "./publish-input-contract";
export * from "./idempotency-contract";
export * from "./result-contract";
export * from "./error-contract";
export * from "./job-contract";
export * from "./attempt-contract";
export * from "./adapter-contract";
export * from "./schedule-contract";
export * from "./blog-contract";
