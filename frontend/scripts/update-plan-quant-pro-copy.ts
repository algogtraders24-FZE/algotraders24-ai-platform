// scripts/update-plan-quant-pro-copy.ts
// Quant Pro production launch closure - a narrow, one-off data update.
// prisma/seed.ts is the canonical SOURCE for Plan content, but re-running
// it against a real environment also touches Admin/Products/demo
// agents/knowledge collections attached to a resolved real owner account
// (see seedAdmin/seedProducts/seedUserScopedData in that same file) - far
// more than this closure sprint's scope. This script instead does exactly
// one thing: append "Quant Pro AI strategy builder + backtesting" to
// the features array of the three existing paid Plan rows (pro/elite/
// enterprise), and nothing else - no price/interval/sortOrder/isActive/
// name field is touched, and the free plan is untouched.
//
// Idempotent: skips a plan whose features array already contains the
// line, so running this more than once is safe.
import "dotenv/config";
import { prisma } from "../lib/prisma";

const QUANT_PRO_LINE = "Quant Pro — AI strategy builder + backtesting";
const PAID_PLAN_IDS = ["pro", "elite", "enterprise"] as const;

async function main(): Promise<void> {
  for (const id of PAID_PLAN_IDS) {
    const plan = await prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      console.log(`  SKIP - plan '${id}' not found`);
      continue;
    }
    if (plan.features.includes(QUANT_PRO_LINE)) {
      console.log(`  SKIP - plan '${id}' already has the Quant Pro line`);
      continue;
    }
    await prisma.plan.update({
      where: { id },
      data: { features: [...plan.features, QUANT_PRO_LINE] },
    });
    console.log(`  UPDATED - plan '${id}' features now: ${JSON.stringify([...plan.features, QUANT_PRO_LINE])}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
