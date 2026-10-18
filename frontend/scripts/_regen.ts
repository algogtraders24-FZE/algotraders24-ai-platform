import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { regenerateApiKey } from "../services/licensing/licenseService";
import { composeLicenseKey } from "../services/licensing/licenseKey";
(async () => {
  const [id, out] = [process.argv[2], process.argv[3]];
  await prisma.activation.deleteMany({ where: { licenseId: id } });
  await prisma.license.update({ where: { id }, data: { licenseStatus: "ISSUED" } });
  const lic = await prisma.license.findUniqueOrThrow({ where: { id } });
  const r = await regenerateApiKey(id, lic.buyerId);
  if (!r.ok) throw new Error(r.code);
  writeFileSync(out, composeLicenseKey(id, r.rawApiKey));
  console.log("key regenerated for", lic.tradingSystemId, "- activations cleared");
  process.exit(0);
})().catch((e) => { console.error("CRASH", e?.message ?? e); process.exit(2); });
