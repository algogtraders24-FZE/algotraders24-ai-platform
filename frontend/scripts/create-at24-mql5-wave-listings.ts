// scripts/create-at24-mql5-wave-listings.ts
// The 7 AT24 MT5 products that were first listed on MQL5 Market and are now added to the AT24 marketplace:
// Regime AI, Strategy Fit, Position Scanner (33 USD), Currency Strength Meter, Trade Manager (49 USD), SMC Toolkit, Prop Firm Guard (59 USD).
// All are licensed Expert Advisor files (indicators are embedded and loaded by the EA). Prices set by the owner 2026-11-24.
//   npx tsx scripts/create-at24-mql5-wave-listings.ts            -> creates/updates the listings as DRAFT (not visible)
//   npx tsx scripts/create-at24-mql5-wave-listings.ts --publish  -> also sets publicationState PUBLISHED
// Data (zip names, descriptions, icons, banners) comes from ea-research/marketplace-research/m19-mql5-wave/listings.json,
// built by ea-research/lab/MQL5Market/web_pack.py. trustState is never touched (honest "Not checked"); no validation claims are made.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m19-mql5-wave");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");
const VERSION = "1.00";

type Item = { slug: string; title: string; id: string; price: number; zip: string; icon: string; banner: string; tags: string[]; description: string };

async function main() {
  const publish = process.argv.includes("--publish");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const items: Item[] = JSON.parse(await readFile(path.join(ROOT, "listings.json"), "utf-8"));
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);
  await mkdir(RELEASES_DIR, { recursive: true });

  for (const p of items) {
    if (only && p.slug !== only) continue;
    const versionId = `${p.id}-v${VERSION}`;
    const bytes = await readFile(path.join(ROOT, p.zip));
    const artifactHash = createHash("sha256").update(bytes).digest("hex");
    const release = await prisma.releaseArtifact.upsert({
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.id, versionId, platform: "MT5", artifactHash } },
      create: { tradingSystemId: p.id, versionId, platform: "MT5", artifactVersion: `v${VERSION}`, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.zip`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), p.zip, "utf-8");

    const pricing = { model: "one_time", amount: p.price, currency: "USD" };
    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing, category: "Utility", platformTag: "MT5", assetTag: "Multi-asset", tags: p.tags,
        tradingSystemId: p.id, versionId, publicationState: "DRAFT",
      },
      update: { title: p.title, description: p.description, tags: p.tags, versionId, tradingSystemId: p.id, pricing },
    });
    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(ROOT, "branding", p.icon), path.join(mediaDir, "icon2.png"));
    await copyFile(path.join(ROOT, "branding", p.banner), path.join(mediaDir, "banner2.png"));
    const media = [`/marketplace/${listing.id}/icon2.png`, `/marketplace/${listing.id}/banner2.png`];
    const saved = await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: publish ? { media, publicationState: "PUBLISHED" } : { media },
    });
    console.log(`${saved.slug} | id ${saved.id} | ${saved.publicationState} | ${p.price} USD | release ${release.id} sha256 ${artifactHash.slice(0, 12)}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
