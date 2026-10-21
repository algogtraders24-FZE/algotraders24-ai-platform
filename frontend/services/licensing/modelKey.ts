// services/licensing/modelKey.ts
// Product "model vault" keys. The trained ONNX model of a product is shipped INSIDE the .ex5 only in encrypted form; the key that
// opens it is handed out by the licence check (POST /api/license/check with "wantModel": true) to a VALID licence only
// (right product, not expired / revoked, account bound). A leaked or copied .ex5 therefore contains no usable model, and a trial
// licence stops getting the key the moment it expires.
//
// The key is derived (HKDF-SHA256) from the server's licence signing key, so no new secret has to be configured and the key can be
// re-derived offline by the build tool (scripts/print-model-key.ts) from the same environment. It is bound to the product id and a
// model version: bump the version in MODEL_VERSIONS when a model is re-released, and a key that leaked earlier opens only the old blob.
//
// Honest limit: a licensee who runs the EA can still read the decrypted model from memory. This protects the file (resource
// extraction, a copied .ex5, an expired trial), not a determined attacker with a debugger.
import { hkdfSync } from "node:crypto";

/** Products whose model is shipped encrypted, and the current model version (part of the key derivation). */
export const MODEL_VERSIONS: Record<string, string> = {
  XXXUS30: "v2", // v1 key was shown in a build log during development and is retired: never used for a shipped blob
};

function keyMaterial(raw: string): Buffer {
  // Same tolerance as the licence signer: escaped \n, PEM markers and whitespace are ignored; only the base64 body counts.
  const body = raw
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN[^-]*-----/gi, "")
    .replace(/-----END[^-]*-----/gi, "")
    .replace(/\s+/g, "");
  if (body.length < 32) throw new Error("LICENSE_SIGNING_PRIVATE_KEY is missing or too short - cannot derive a model key.");
  return Buffer.from(body, "utf8");
}

/** 32-byte key as 64 hex chars, or null when the product has no encrypted model. */
export function modelKeyFor(tradingSystemId: string, env: Record<string, string | undefined> = process.env): string | null {
  const version = MODEL_VERSIONS[tradingSystemId];
  if (!version) return null;
  const raw = env.LICENSE_SIGNING_PRIVATE_KEY;
  if (!raw) throw new Error("LICENSE_SIGNING_PRIVATE_KEY is not set - cannot derive a model key.");
  const okm = hkdfSync("sha256", keyMaterial(raw), Buffer.from("at24-model-vault", "utf8"), Buffer.from(`model|${tradingSystemId}|${version}`, "utf8"), 32);
  return Buffer.from(okm).toString("hex");
}
