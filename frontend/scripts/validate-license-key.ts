// scripts/validate-license-key.ts - offline checks for the one-string licence key format:
//   npx tsx scripts/validate-license-key.ts
import assert from "node:assert/strict";
import { composeLicenseKey, parseLicenseKey, cleanAccount, cleanServer, LICENSE_KEY_PREFIX } from "../services/licensing/licenseKey";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`  ok   - ${name}`);
}

const licenseId = "lic_cmu82hy00000004jnz5dcmtxg_mu82hxvj";
const apiKey = "at24_lic_" + "a1b2c3d4".repeat(8);

console.log("Licence key validation");
ok("compose then parse returns exactly the two credentials", () => {
  const k = composeLicenseKey(licenseId, apiKey);
  assert.ok(k.startsWith(LICENSE_KEY_PREFIX));
  assert.deepEqual(parseLicenseKey(k), { licenseId, rawApiKey: apiKey });
});
ok("surrounding whitespace is tolerated (copy/paste)", () => {
  assert.deepEqual(parseLicenseKey(`  ${composeLicenseKey(licenseId, apiKey)}\n`), { licenseId, rawApiKey: apiKey });
});
ok("anything malformed parses to null and never throws", () => {
  for (const bad of [undefined, null, 5, {}, "", "AT24-", "AT24-x.y", "lic_x.y", `AT24-${licenseId}`, `AT24-${licenseId}.`, `AT24-.${apiKey}`, `AT24-${licenseId}.${apiKey}.extra`, "AT24-a b.cccccccccccccccccccc", `AT24-${licenseId}.${"x".repeat(500)}`]) {
    assert.equal(parseLicenseKey(bad as unknown), null, String(bad));
  }
});
ok("injection-style characters are rejected", () => {
  assert.equal(parseLicenseKey(`AT24-${licenseId}.${apiKey}"}; DROP`), null);
  assert.equal(parseLicenseKey(`AT24-li/../cense.${apiKey}`), null);
});
ok("account and server cleaning", () => {
  assert.equal(cleanAccount(12345678), "12345678");
  assert.equal(cleanAccount(" 8765 "), "8765");
  assert.equal(cleanAccount("a;b"), "");
  assert.equal(cleanAccount(""), "");
  assert.equal(cleanAccount(undefined), "");
  assert.equal(cleanServer("Exness-MT5Trial8"), "Exness-MT5Trial8");
  assert.equal(cleanServer("<script>"), "");
});
console.log(`\n${pass} checks passed.`);
