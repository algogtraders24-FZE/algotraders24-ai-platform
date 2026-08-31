import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidated, markValidated, type ResearchResult } from "../src/domain/research-result.js";

function candidateResult(): ResearchResult {
  return { experimentId: "exp-1", status: "CANDIDATE", producedAt: Date.now() };
}

test("a freshly-produced result is not validated", () => {
  const result: ResearchResult = { experimentId: "exp-1", status: "COMPLETED", producedAt: Date.now() };
  assert.equal(isValidated(result), false);
});

test("markValidated transitions a CANDIDATE result to VALIDATED", () => {
  const validated = markValidated(candidateResult(), Date.now());
  assert.equal(validated.status, "VALIDATED");
  assert.equal(isValidated(validated), true);
  assert.ok(validated.validatedAt !== undefined);
});

test("markValidated refuses to validate an UNRUN result", () => {
  assert.throws(() => markValidated({ experimentId: "exp-1", status: "UNRUN", producedAt: Date.now() }, Date.now()));
});

test("markValidated refuses to validate a FAILED result", () => {
  assert.throws(() =>
    markValidated({ experimentId: "exp-1", status: "FAILED", failureReason: "crash", producedAt: Date.now() }, Date.now()),
  );
});

test("markValidated refuses to validate a REJECTED result", () => {
  assert.throws(() =>
    markValidated({ experimentId: "exp-1", status: "REJECTED", rejectionReason: "too few trades", producedAt: Date.now() }, Date.now()),
  );
});

test("markValidated refuses to re-validate an already-VALIDATED result", () => {
  const validated = markValidated(candidateResult(), Date.now());
  assert.throws(() => markValidated(validated, Date.now()));
});

test("status literals are exactly the six defined values, nothing implicitly treated as validated", () => {
  const statuses: ResearchResult["status"][] = ["UNRUN", "COMPLETED", "FAILED", "REJECTED", "CANDIDATE", "VALIDATED"];
  for (const status of statuses) {
    const result: ResearchResult = { experimentId: "exp-1", status, producedAt: Date.now() };
    assert.equal(isValidated(result), status === "VALIDATED");
  }
});
