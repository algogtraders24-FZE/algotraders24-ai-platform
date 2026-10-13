// scripts/validate-ai-resilience.ts - retry / fallback / plain-words errors around the AI call that writes the market brief. Pure. `npm run validate:ai-resilience`.
import assert from "node:assert/strict";
import { completeWithResilience, isTransientAiError, friendlyAiMessage, AI_BUSY_MESSAGE } from "../services/ai/ai-resilience";
import { AIProviderError } from "../lib/ai/errors";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const GEMINI_503 = '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';
const busy = () => new AIProviderError("unknown", GEMINI_503, "gemini");

async function main(): Promise<void> {
  console.log("validate-ai-resilience\n");

  await test("the real Gemini 503 'high demand' error is transient; auth / invalid input are not", () => {
    assert.equal(isTransientAiError(busy()), true);
    assert.equal(isTransientAiError(new AIProviderError("rate_limit", "x", "g")), true);
    assert.equal(isTransientAiError(new AIProviderError("network", "x", "g")), true);
    assert.equal(isTransientAiError(new AIProviderError("timeout", "x", "g")), true);
    assert.equal(isTransientAiError(new AIProviderError("auth", "API key invalid", "g")), false);
    assert.equal(isTransientAiError(new AIProviderError("invalid_input", "bad prompt", "g")), false);
    assert.equal(isTransientAiError(new Error("boom")), false);
  });

  await test("success on the first try: one call, no sleep", async () => {
    let calls = 0;
    let slept = 0;
    const r = await completeWithResilience({ primary: async () => (calls += 1, "ok"), fallback: null, sleep: async () => void (slept += 1) });
    assert.deepEqual([r, calls, slept], ["ok", 1, 0]);
  });

  await test("a transient failure is retried once after the delay and then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    const r = await completeWithResilience({
      primary: async () => {
        calls += 1;
        if (calls === 1) throw busy();
        return "second try";
      },
      fallback: null,
      sleep: async (ms) => void delays.push(ms),
    });
    assert.deepEqual([r, calls, delays], ["second try", 2, [1500]]);
  });

  await test("transient twice -> the secondary provider answers", async () => {
    let primary = 0;
    const r = await completeWithResilience({
      primary: async () => {
        primary += 1;
        throw busy();
      },
      fallback: async () => "from claude",
      sleep: async () => {},
    });
    assert.deepEqual([r, primary], ["from claude", 2]);
  });

  await test("transient twice with no secondary provider -> the error is thrown (and reads in plain words)", async () => {
    await assert.rejects(
      () => completeWithResilience({ primary: async () => { throw busy(); }, fallback: null, sleep: async () => {} }),
      (e: unknown) => friendlyAiMessage(e) === AI_BUSY_MESSAGE,
    );
  });

  await test("a non-transient error is thrown at once: no retry, no sleep, no fallback", async () => {
    let calls = 0;
    let slept = 0;
    let fb = 0;
    await assert.rejects(() =>
      completeWithResilience({
        primary: async () => {
          calls += 1;
          throw new AIProviderError("auth", "API key invalid", "gemini");
        },
        fallback: async () => (fb += 1, "x"),
        sleep: async () => void (slept += 1),
      }),
    );
    assert.deepEqual([calls, slept, fb], [1, 0, 0]);
  });

  await test("messages: busy -> plain words (never the raw JSON); typed message kept; raw JSON from a non-transient error -> generic", () => {
    assert.equal(friendlyAiMessage(busy()), AI_BUSY_MESSAGE);
    assert.ok(!friendlyAiMessage(busy()).includes("{"));
    assert.equal(friendlyAiMessage(new AIProviderError("auth", "API key invalid", "g")), "API key invalid");
    assert.equal(friendlyAiMessage(new AIProviderError("invalid_output", '{"weird":"json"}', "g")), "The AI analysis could not be completed.");
    assert.equal(friendlyAiMessage("x"), "The AI analysis could not be completed.");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
