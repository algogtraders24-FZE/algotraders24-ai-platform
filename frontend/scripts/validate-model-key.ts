// scripts/validate-model-key.ts - the model-vault key derivation (pure, no network). Run: npx tsx scripts/validate-model-key.ts
import { modelKeyFor, MODEL_VERSIONS } from "../services/licensing/modelKey";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

const envA = { LICENSE_SIGNING_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIBase64MaterialForTestsOnlyAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END PRIVATE KEY-----" };
const envAone = { LICENSE_SIGNING_PRIVATE_KEY: "-----BEGIN PRIVATE KEY----- MC4CAQAwBQYDK2VwBCIEIBase64MaterialForTestsOnlyAAAAAAAAAAAAAAAAAAAAAAAAAAAA -----END PRIVATE KEY-----" };
const envAesc = { LICENSE_SIGNING_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMC4CAQAwBQYDK2VwBCIEIBase64MaterialForTestsOnlyAAAAAAAAAAAAAAAAAAAAAAAAAAAA\\n-----END PRIVATE KEY-----" };
const envB = { LICENSE_SIGNING_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIDifferentMaterialForTestsOnlyBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n-----END PRIVATE KEY-----" };

const k = modelKeyFor("XXXUS30", envA);
check("a registered product gets a 64-hex key", !!k && /^[0-9a-f]{64}$/.test(k));
check("deterministic", modelKeyFor("XXXUS30", envA) === k);
check("PEM whitespace / one-line / escaped-newline forms of the same key give the same key", modelKeyFor("XXXUS30", envAone) === k && modelKeyFor("XXXUS30", envAesc) === k);
check("a different signing key gives a different model key", modelKeyFor("XXXUS30", envB) !== k);
check("a product without an encrypted model gets no key", modelKeyFor("GOLDSNIPER", envA) === null);
check("model versions are registered", MODEL_VERSIONS.XXXUS30 === "v2");
let threw = false;
try {
  modelKeyFor("XXXUS30", {});
} catch {
  threw = true;
}
check("missing signing key throws (never a default key)", threw);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
