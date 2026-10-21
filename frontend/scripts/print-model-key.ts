// scripts/print-model-key.ts
// Build-time helper: prints the 64-hex model-vault key of a product (see services/licensing/modelKey.ts) so the build tool can encrypt
// the product's ONNX model. The key comes from the same environment the server uses; treat the output like a password - do not commit,
// paste into chat or store it in a repository.
// Usage: npx tsx scripts/print-model-key.ts XXXUS30
import { config } from "dotenv";
config({ quiet: true });
config({ path: ".env.local", quiet: true });
import { modelKeyFor } from "../services/licensing/modelKey";

const product = process.argv[2];
if (!product) {
  console.error("usage: print-model-key.ts <tradingSystemId>");
  process.exit(1);
}
const key = modelKeyFor(product);
if (!key) {
  console.error(`No encrypted model registered for ${product} (see MODEL_VERSIONS).`);
  process.exit(2);
}
process.stdout.write(key);
