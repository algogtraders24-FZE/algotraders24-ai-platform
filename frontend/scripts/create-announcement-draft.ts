// scripts/create-announcement-draft.ts
// Creates a product announcement DRAFT from a JSON file (see docs/announcements/*.json). It never sends anything: the draft shows up in
// Dashboard > Admin > Announcements, where an admin sends a test to themselves and then sends it to everyone.
// Usage: npx tsx --conditions=react-server scripts/create-announcement-draft.ts ../docs/announcements/gold-sniper.json
import "dotenv/config";
import { readFileSync } from "fs";
import { prisma } from "../lib/prisma";
import { validateAnnouncement } from "../services/announcements/service";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: create-announcement-draft.ts <draft.json>");
  const c = JSON.parse(readFileSync(file, "utf8")) as { subject: string; preheader?: string; bodyText: string; ctaLabel?: string; ctaUrl?: string };
  const err = validateAnnouncement(c);
  if (err) throw new Error(`Draft not valid: ${err}`);
  const existing = await prisma.productAnnouncement.findFirst({ where: { subject: c.subject } });
  if (existing) {
    console.log(`Already exists (${existing.status}): ${existing.id} - not creating a duplicate.`);
    return;
  }
  const row = await prisma.productAnnouncement.create({
    data: { subject: c.subject.trim(), preheader: c.preheader ?? null, bodyText: c.bodyText.trim(), ctaLabel: c.ctaLabel ?? null, ctaUrl: c.ctaUrl ?? null, createdBy: "script" },
  });
  console.log(`Draft created: ${row.id} - open Dashboard > Admin > Announcements to test and send.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
