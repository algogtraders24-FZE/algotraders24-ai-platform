// scripts/validate-publishing-contract.ts
// AT24 Publishing Contract - P2.1 contract-level validation.
//
// Pure / in-memory only - no database, no network, no Next.js runtime. Runs
// via `npm run validate:publishing-contract` (tsx + node:assert/strict), the
// house test pattern (AN1.2 D2: no Vitest).
//
// Covers Sprint P2.1 §22: status vocab + transitions, destination registry,
// content-hash determinism, idempotency identity, error retry classification,
// adapter conformance, and the authorization-boundary expectation.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  PUBLISHING_CONTRACT_VERSION,
  // destination
  PUBLISHING_DESTINATION_IDS,
  PUBLISHING_DESTINATIONS,
  isPublishingDestinationId,
  getPublishingDestination,
  // input + hash basis
  CONTENT_HASH_FIELDS,
  canonicalContentBasis,
  isNormalizedPublishInput,
  validateNormalizedPublishInput,
  type NormalizedPublishInput,
  type PublishableContent,
  // idempotency
  publicationIdentityKey,
  parsePublicationIdentityKey,
  publicationIdentityEquals,
  isPublicationIdentity,
  type PublicationIdentity,
  // job
  PUBLISHING_JOB_STATUSES,
  TERMINAL_PUBLISHING_JOB_STATUSES,
  isPublishingJobStatus,
  isValidJobTransition,
  validateJobTransition,
  isTerminalPublishingJobStatus,
  ARTICLE_STATUS_ON_JOB_SUCCESS,
  validatePublishingJob,
  type PublishingJob,
  // attempt
  PUBLISHING_ATTEMPT_STATUSES,
  isValidAttemptTransition,
  validatePublishingAttempt,
  type PublishingAttempt,
  // result
  isPublishResult,
  validatePublishResult,
  type PublishResult,
  // error
  PUBLISH_ERROR_CODES,
  PUBLISH_ERROR_RETRY_CLASS,
  RETRYABLE_PUBLISH_ERROR_CODES,
  makePublishError,
  isPublishError,
  isRetryablePublishErrorCode,
  isDuplicatePublishError,
  retryClassFor,
  validatePublishError,
  // adapter
  isDestinationAdapter,
  type DestinationAdapter,
  type AdapterValidationResult,
} from "../types/publishing";

import {
  computeContentHash,
  buildNormalizedPublishInput,
  contentHashMatches,
} from "../services/publishing/content-hash";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok   - ${name}`);
    })
    .catch((err: unknown) => {
      failed += 1;
      console.error(`  FAIL - ${name}`);
      console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
    });
}

// ---- fixtures ---------------------------------------------------------------

const CONTENT_A: PublishableContent = {
  title: "Gold Analysis",
  slug: "gold-analysis",
  body: "Current conditions favor a constructive scenario for XAUUSD.",
  excerpt: "Overview, key levels, and outlook.",
  canonicalUrl: "https://algotraders24.ai/blog/gold-analysis",
  disclaimer: "This is not financial advice. Trading involves risk.",
  seo: { metaDescription: "Gold analysis - key levels and outlook.", keywords: ["gold", "xauusd", "outlook"] },
};

function normInput(over: Partial<NormalizedPublishInput> = {}): NormalizedPublishInput {
  return buildNormalizedPublishInput({
    articleId: "art_123",
    destination: "INTERNAL_BLOG",
    ...CONTENT_A,
    ...over,
  });
}

const NOW = "2026-09-08T12:00:00.000Z";
const LATER = "2026-09-08T12:00:05.000Z";

// A conformant in-test adapter. Deliberately trivial: it proves the interface
// is satisfiable with ZERO knowledge of React / HTTP / Prisma / cron / agents.
class FakeInternalBlogAdapter implements DestinationAdapter {
  readonly destination = "INTERNAL_BLOG" as const;
  public lastInput: NormalizedPublishInput | null = null;

  async validate(input: NormalizedPublishInput): Promise<AdapterValidationResult> {
    const errors = [];
    if (input.body.trim().length === 0) {
      errors.push(makePublishError("VALIDATION_ERROR", "body is empty", { destination: this.destination }));
    }
    return { valid: errors.length === 0, errors };
  }

  async publish(input: NormalizedPublishInput): Promise<PublishResult> {
    this.lastInput = input;
    return {
      success: true,
      destination: this.destination,
      externalReference: null, // INTERNAL_BLOG issues none - never fabricated
      externalUrl: input.canonicalUrl,
      publishedAt: NOW,
    };
  }
}

// ---- tests ----------------------------------------------------------------

async function main() {
  console.log(`\nPublishing Contract ${PUBLISHING_CONTRACT_VERSION} - validation\n`);

  // -- Contract version -----------------------------------------------------
  await test("contract version is PUB-v1", () => {
    assert.equal(PUBLISHING_CONTRACT_VERSION, "PUB-v1");
  });

  // -- Destinations (§7) --------------------------------------------------
  await test("INTERNAL_BLOG is the only registered destination", () => {
    assert.deepEqual([...PUBLISHING_DESTINATION_IDS], ["INTERNAL_BLOG"]);
    assert.ok(isPublishingDestinationId("INTERNAL_BLOG"));
  });
  await test("unknown destination is rejected", () => {
    assert.equal(isPublishingDestinationId("WORDPRESS"), false);
    assert.equal(isPublishingDestinationId("internal_blog"), false); // case-sensitive
    assert.equal(isPublishingDestinationId(""), false);
    assert.equal(isPublishingDestinationId(null), false);
  });
  await test("INTERNAL_BLOG descriptor: no external creds, no fabricated external id", () => {
    const d = getPublishingDestination("INTERNAL_BLOG");
    assert.equal(d.requiresExternalCredentials, false);
    assert.equal(d.providesExternalReference, false);
    assert.equal(PUBLISHING_DESTINATIONS.INTERNAL_BLOG.id, "INTERNAL_BLOG");
  });

  // -- Content hash (§10) -------------------------------------------------
  await test("contentHash is deterministic for identical content", () => {
    assert.equal(computeContentHash(CONTENT_A), computeContentHash({ ...CONTENT_A }));
  });
  await test("contentHash matches an explicit sha256 of the documented basis", () => {
    const expected = createHash("sha256").update(canonicalContentBasis(CONTENT_A), "utf8").digest("hex");
    assert.equal(computeContentHash(CONTENT_A), expected);
    assert.match(computeContentHash(CONTENT_A), /^[0-9a-f]{64}$/);
  });
  await test("contentHash changes when a participating field changes", () => {
    const base = computeContentHash(CONTENT_A);
    assert.notEqual(base, computeContentHash({ ...CONTENT_A, title: "Gold Analysis " })); // trailing space is real
    assert.notEqual(base, computeContentHash({ ...CONTENT_A, body: CONTENT_A.body + "." }));
    assert.notEqual(
      base,
      computeContentHash({ ...CONTENT_A, seo: { ...CONTENT_A.seo, keywords: ["xauusd", "gold", "outlook"] } }),
    ); // keyword ORDER is significant
  });
  await test("contentHash does NOT depend on articleId or destination", () => {
    const a = buildNormalizedPublishInput({ articleId: "art_1", destination: "INTERNAL_BLOG", ...CONTENT_A });
    const b = buildNormalizedPublishInput({ articleId: "art_2", destination: "INTERNAL_BLOG", ...CONTENT_A });
    assert.equal(a.contentHash, b.contentHash);
    assert.equal(a.contentHash, computeContentHash(CONTENT_A));
  });
  await test("CONTENT_HASH_FIELDS documents exactly the participating fields", () => {
    assert.deepEqual(
      [...CONTENT_HASH_FIELDS],
      ["title", "slug", "body", "excerpt", "canonicalUrl", "disclaimer", "seo.metaDescription", "seo.keywords"],
    );
  });
  await test("contentHashMatches / buildNormalizedPublishInput round-trip", () => {
    const input = normInput();
    assert.ok(contentHashMatches(input));
    assert.ok(isNormalizedPublishInput(input));
    assert.equal(validateNormalizedPublishInput(input).valid, true);
  });
  await test("a tampered contentHash fails contentHashMatches but not the shape gate", () => {
    const input = { ...normInput(), contentHash: "0".repeat(64) };
    assert.equal(contentHashMatches(input), false);
    assert.equal(isNormalizedPublishInput(input), true); // shape is still valid; integrity is a separate check
  });
  await test("NormalizedPublishInput validation catches missing / malformed fields", () => {
    assert.equal(validateNormalizedPublishInput({}).valid, false);
    assert.equal(validateNormalizedPublishInput({ ...normInput(), slug: "Not A Slug" }).valid, false);
    assert.equal(validateNormalizedPublishInput({ ...normInput(), destination: "WORDPRESS" }).valid, false);
    assert.equal(validateNormalizedPublishInput({ ...normInput(), contentHash: "short" }).valid, false);
  });

  // -- Idempotency identity (§11) ---------------------------------------
  await test("same article + destination + contentHash => same identity key", () => {
    const h = computeContentHash(CONTENT_A);
    const id1: PublicationIdentity = { articleId: "art_123", destination: "INTERNAL_BLOG", contentHash: h };
    const id2: PublicationIdentity = { articleId: "art_123", destination: "INTERNAL_BLOG", contentHash: h };
    assert.equal(publicationIdentityKey(id1), publicationIdentityKey(id2));
    assert.ok(publicationIdentityEquals(id1, id2));
    assert.equal(publicationIdentityKey(id1), `art_123:INTERNAL_BLOG:${h}`);
  });
  await test("changed contentHash => different identity (new publication)", () => {
    const h1 = computeContentHash(CONTENT_A);
    const h2 = computeContentHash({ ...CONTENT_A, body: CONTENT_A.body + " Updated." });
    const id1: PublicationIdentity = { articleId: "art_123", destination: "INTERNAL_BLOG", contentHash: h1 };
    const id2: PublicationIdentity = { articleId: "art_123", destination: "INTERNAL_BLOG", contentHash: h2 };
    assert.notEqual(publicationIdentityKey(id1), publicationIdentityKey(id2));
    assert.equal(publicationIdentityEquals(id1, id2), false);
  });
  await test("identity key parses back to its parts", () => {
    const h = computeContentHash(CONTENT_A);
    const id: PublicationIdentity = { articleId: "art_123", destination: "INTERNAL_BLOG", contentHash: h };
    assert.deepEqual(parsePublicationIdentityKey(publicationIdentityKey(id)), id);
    assert.equal(parsePublicationIdentityKey("only:two"), null);
    assert.equal(parsePublicationIdentityKey("a:WORDPRESS:" + h), null);
  });
  await test("isPublicationIdentity rejects malformed", () => {
    assert.equal(isPublicationIdentity({ articleId: "a", destination: "INTERNAL_BLOG", contentHash: "x" }), false);
    assert.ok(isPublicationIdentity({ articleId: "a", destination: "INTERNAL_BLOG", contentHash: "a".repeat(64) }));
  });

  // -- Job status (§5) ------------------------------------------------------
  await test("job statuses are exactly the 5 specified", () => {
    assert.deepEqual([...PUBLISHING_JOB_STATUSES], ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);
  });
  await test("invalid job status rejected", () => {
    assert.equal(isPublishingJobStatus("DONE"), false);
    assert.equal(isPublishingJobStatus("pending"), false);
  });
  await test("job terminal set is { SUCCEEDED, CANCELLED }; FAILED is not terminal", () => {
    assert.deepEqual([...TERMINAL_PUBLISHING_JOB_STATUSES].sort(), ["CANCELLED", "SUCCEEDED"]);
    assert.equal(isTerminalPublishingJobStatus("FAILED"), false);
  });
  await test("job transitions: the happy path and the retry loop are permitted", () => {
    assert.ok(isValidJobTransition("PENDING", "RUNNING"));
    assert.ok(isValidJobTransition("RUNNING", "SUCCEEDED"));
    assert.ok(isValidJobTransition("RUNNING", "FAILED"));
    assert.ok(isValidJobTransition("FAILED", "RUNNING")); // retry
    assert.ok(isValidJobTransition("FAILED", "PENDING")); // re-queue
    assert.ok(isValidJobTransition("PENDING", "CANCELLED"));
    assert.ok(isValidJobTransition("FAILED", "CANCELLED")); // give up
  });
  await test("job transitions: illegal moves are rejected", () => {
    assert.equal(isValidJobTransition("SUCCEEDED", "RUNNING"), false); // terminal
    assert.equal(isValidJobTransition("CANCELLED", "PENDING"), false); // terminal
    assert.equal(isValidJobTransition("PENDING", "SUCCEEDED"), false); // must run first
    assert.equal(validateJobTransition("SUCCEEDED", "PENDING").valid, false);
    assert.equal(validateJobTransition("PENDING", "RUNNING").valid, true);
  });
  await test("ARTICLE_STATUS_ON_JOB_SUCCESS keeps ArticleStatus separate & advisory", () => {
    assert.equal(ARTICLE_STATUS_ON_JOB_SUCCESS.SUCCEEDED, "published");
    assert.equal(ARTICLE_STATUS_ON_JOB_SUCCESS.PENDING, null);
    assert.equal(ARTICLE_STATUS_ON_JOB_SUCCESS.RUNNING, null);
  });

  // -- PublishingJob shape (§15 ownership carried) -----------------------
  await test("a well-formed PublishingJob validates; userId is required", () => {
    const h = computeContentHash(CONTENT_A);
    const job: PublishingJob = {
      id: "job_1",
      articleId: "art_123",
      userId: "user_1",
      destination: "INTERNAL_BLOG",
      status: "PENDING",
      contentHash: h,
      idempotencyKey: `art_123:INTERNAL_BLOG:${h}`,
      requestedAt: NOW,
      attemptCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    assert.equal(validatePublishingJob(job).valid, true);
    const noOwner = { ...job } as Record<string, unknown>;
    delete noOwner.userId;
    assert.equal(validatePublishingJob(noOwner).valid, false); // ownership boundary
  });
  await test("a SUCCEEDED job must carry a result; a FAILED job must carry an error", () => {
    const h = computeContentHash(CONTENT_A);
    const base: PublishingJob = {
      id: "job_2", articleId: "art_123", userId: "user_1", destination: "INTERNAL_BLOG",
      status: "SUCCEEDED", contentHash: h, idempotencyKey: `art_123:INTERNAL_BLOG:${h}`,
      requestedAt: NOW, attemptCount: 1, createdAt: NOW, updatedAt: LATER,
    };
    assert.equal(validatePublishingJob(base).valid, false); // SUCCEEDED w/o result
    base.result = { success: true, destination: "INTERNAL_BLOG", externalReference: null, externalUrl: CONTENT_A.canonicalUrl, publishedAt: NOW };
    assert.equal(validatePublishingJob(base).valid, true);

    const failed: PublishingJob = { ...base, id: "job_3", status: "FAILED", result: null };
    assert.equal(validatePublishingJob(failed).valid, false); // FAILED w/o error
    failed.lastError = makePublishError("TEMPORARY_FAILURE", "destination 503");
    assert.equal(validatePublishingJob(failed).valid, true);
  });

  // -- Attempt (§6) -----------------------------------------------------
  await test("attempt statuses + transitions", () => {
    assert.deepEqual([...PUBLISHING_ATTEMPT_STATUSES], ["RUNNING", "SUCCEEDED", "FAILED"]);
    assert.ok(isValidAttemptTransition("RUNNING", "SUCCEEDED"));
    assert.ok(isValidAttemptTransition("RUNNING", "FAILED"));
    assert.equal(isValidAttemptTransition("SUCCEEDED", "FAILED"), false);
    assert.equal(isValidAttemptTransition("FAILED", "RUNNING"), false); // a retry is a NEW attempt row
  });
  await test("attempt numbering is 1-based; terminal needs completedAt; FAILED needs error", () => {
    const running: PublishingAttempt = {
      id: "att_1", jobId: "job_1", attemptNumber: 1, status: "RUNNING", startedAt: NOW, createdAt: NOW,
    };
    assert.equal(validatePublishingAttempt(running).valid, true);
    assert.equal(validatePublishingAttempt({ ...running, attemptNumber: 0 }).valid, false);
    assert.equal(validatePublishingAttempt({ ...running, status: "FAILED", completedAt: LATER }).valid, false); // no error
    assert.equal(
      validatePublishingAttempt({
        ...running, status: "FAILED", completedAt: LATER, error: makePublishError("RATE_LIMITED", "429"),
      }).valid,
      true,
    );
    assert.equal(validatePublishingAttempt({ ...running, status: "SUCCEEDED" }).valid, false); // no completedAt
  });
  await test("a 3-attempt job history (FAILED, FAILED, SUCCEEDED) all validates", () => {
    const mk = (n: number, status: PublishingAttempt["status"], extra: Partial<PublishingAttempt>): PublishingAttempt => ({
      id: `att_${n}`, jobId: "job_1", attemptNumber: n, status, startedAt: NOW, completedAt: LATER, createdAt: NOW, ...extra,
    });
    const history = [
      mk(1, "FAILED", { error: makePublishError("RATE_LIMITED", "429") }),
      mk(2, "FAILED", { error: makePublishError("TEMPORARY_FAILURE", "503") }),
      mk(3, "SUCCEEDED", { externalReference: null, externalUrl: CONTENT_A.canonicalUrl }),
    ];
    for (const a of history) assert.equal(validatePublishingAttempt(a).valid, true, `attempt ${a.attemptNumber}`);
    assert.deepEqual(history.map((a) => a.attemptNumber), [1, 2, 3]);
  });

  // -- Result (§12) ---------------------------------------------------
  await test("PublishResult: external fields optional; INTERNAL_BLOG needs no fake id", () => {
    const r: PublishResult = { success: true, destination: "INTERNAL_BLOG", externalReference: null, externalUrl: null, publishedAt: NOW };
    assert.ok(isPublishResult(r));
    assert.equal(validatePublishResult(r).valid, true);
    assert.equal(validatePublishResult({ ...r, success: false }).valid, false);
    assert.equal(validatePublishResult({ ...r, publishedAt: "not-a-date" }).valid, false);
  });

  // -- Error taxonomy + retry semantics (§13, §14) -------------------
  await test("error codes are exactly the 8 specified", () => {
    assert.deepEqual(
      [...PUBLISH_ERROR_CODES],
      ["VALIDATION_ERROR", "AUTHENTICATION_ERROR", "AUTHORIZATION_ERROR", "RATE_LIMITED", "TEMPORARY_FAILURE", "PERMANENT_FAILURE", "DUPLICATE", "UNKNOWN"],
    );
  });
  await test("retryable = { RATE_LIMITED, TEMPORARY_FAILURE }", () => {
    assert.deepEqual([...RETRYABLE_PUBLISH_ERROR_CODES].sort(), ["RATE_LIMITED", "TEMPORARY_FAILURE"]);
    assert.ok(isRetryablePublishErrorCode("RATE_LIMITED"));
    assert.ok(isRetryablePublishErrorCode("TEMPORARY_FAILURE"));
  });
  await test("non-retryable = validation / auth / authz / permanent / unknown", () => {
    for (const code of ["VALIDATION_ERROR", "AUTHENTICATION_ERROR", "AUTHORIZATION_ERROR", "PERMANENT_FAILURE", "UNKNOWN"] as const) {
      assert.equal(retryClassFor(code), "NON_RETRYABLE", code);
      assert.equal(isRetryablePublishErrorCode(code), false, code);
    }
  });
  await test("DUPLICATE is an idempotency condition, not a transient failure", () => {
    assert.equal(PUBLISH_ERROR_RETRY_CLASS.DUPLICATE, "IDEMPOTENT_DUPLICATE");
    assert.equal(isRetryablePublishErrorCode("DUPLICATE"), false);
    assert.ok(isDuplicatePublishError({ code: "DUPLICATE" }));
    assert.equal(isDuplicatePublishError({ code: "RATE_LIMITED" }), false);
  });
  await test("makePublishError keeps retryClass consistent with code; validator enforces it", () => {
    const e = makePublishError("RATE_LIMITED", "429 Too Many Requests", { destination: "INTERNAL_BLOG", cause: "quota 60s" });
    assert.equal(e.retryClass, "RETRYABLE");
    assert.ok(isPublishError(e));
    assert.equal(validatePublishError(e).valid, true);
    assert.equal(validatePublishError({ ...e, retryClass: "NON_RETRYABLE" }).valid, false); // inconsistent
    assert.equal(validatePublishError({ code: "NOPE", message: "x" }).valid, false);
  });

  // -- Adapter conformance (§8, §16) -------------------------------
  await test("FakeInternalBlogAdapter satisfies the DestinationAdapter contract", () => {
    const a = new FakeInternalBlogAdapter();
    assert.ok(isDestinationAdapter(a));
    assert.equal(a.destination, "INTERNAL_BLOG");
  });
  await test("adapter.validate accepts a well-formed normalized input", async () => {
    const a = new FakeInternalBlogAdapter();
    const res = await a.validate(normInput());
    assert.equal(res.valid, true);
    assert.deepEqual(res.errors, []);
  });
  await test("adapter.validate returns VALIDATION_ERROR (does not throw) for bad content", async () => {
    const a = new FakeInternalBlogAdapter();
    const res = await a.validate(normInput({ body: "   " }));
    assert.equal(res.valid, false);
    assert.equal(res.errors[0]?.code, "VALIDATION_ERROR");
    assert.ok(isPublishError(res.errors[0]));
  });
  await test("adapter.publish returns a valid PublishResult for INTERNAL_BLOG", async () => {
    const a = new FakeInternalBlogAdapter();
    const r = await a.publish(normInput());
    assert.equal(validatePublishResult(r).valid, true);
    assert.equal(r.externalReference, null); // no fabricated id
    assert.equal(r.destination, "INTERNAL_BLOG");
  });

  // -- Authorization boundary (§15) -------------------------------
  await test("NormalizedPublishInput carries NO auth material - adapters cannot self-authorize", () => {
    // The type an adapter receives has no session, no role, no token, no
    // "isOwner" flag. Ownership is enforced by the Publishing Service BEFORE
    // this object is built (job-contract.ts#PublishingJob.userId). This test
    // pins that shape so a future edit that leaks auth into the adapter
    // boundary fails loudly.
    const input = normInput();
    const keys = Object.keys(input).sort();
    assert.deepEqual(keys, [
      "articleId", "body", "canonicalUrl", "contentHash", "destination",
      "disclaimer", "excerpt", "seo", "slug", "title",
    ]);
    for (const forbidden of ["userId", "session", "role", "token", "authorization", "isOwner", "permissions"]) {
      assert.equal(forbidden in input, false, `NormalizedPublishInput must not carry "${forbidden}"`);
    }
  });
  await test("the ownership field lives on PublishingJob, above the adapter", () => {
    // Positive side of the previous test: the job (service-layer object) is
    // where userId belongs.
    const h = computeContentHash(CONTENT_A);
    const job: PublishingJob = {
      id: "job_9", articleId: "art_123", userId: "user_1", destination: "INTERNAL_BLOG", status: "PENDING",
      contentHash: h, idempotencyKey: `art_123:INTERNAL_BLOG:${h}`, requestedAt: NOW, attemptCount: 0,
      createdAt: NOW, updatedAt: NOW,
    };
    assert.equal(typeof job.userId, "string");
    assert.equal(validatePublishingJob(job).valid, true);
  });

  // ---- summary ----------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
