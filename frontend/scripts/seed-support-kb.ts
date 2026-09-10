// scripts/seed-support-kb.ts
// Sprint CS1 - bootstrap the platform's SUPPORT knowledge corpus.
//
// Creates a small starter set of `scope = "support"` Knowledge rows across the
// CS1.2 D3 domains (FAQ / products / billing / credits / purchases / licenses /
// troubleshooting / policies / verified resolutions), publishes each through
// the EXISTING K-series flow (KnowledgeService.create -> publishKnowledge ->
// markActive + IngestionService chunk + embed), so the Support Agent's
// `support.knowledge_search` tool has real, governed material to cite.
//
// Idempotent: rows previously seeded by this script (source = SEED_MARKER) are
// hard-deleted (chunks + embeddings cascade) and recreated, so re-running
// always converges to the current content below.
//
// Run: npm run seed:support-kb
//
// NOTE (CS1.1): this is a BOOTSTRAP. Production support-corpus authoring should
// go through the K4 Governance approval path once it exists; a seed script
// calling markActive() directly is the same latitude prisma/seed.ts already
// takes for every other table.

import { prisma } from "../lib/prisma";
import {
  createKnowledgeService,
  publishKnowledge,
  realIngestionPort,
} from "../services/knowledge-loop/knowledge";
import type { KnowledgeType, KnowledgeVisibility } from "../types/knowledge-loop";

const SEED_MARKER = "seed:cs1-support-kb";

interface SeedDoc {
  title: string;
  knowledgeType: KnowledgeType;
  visibility: KnowledgeVisibility;
  category: string;
  canonicalQuestion: string;
  body: string;
}

const DOCS: SeedDoc[] = [
  {
    title: "Changing your subscription plan",
    knowledgeType: "faq",
    visibility: "customer",
    category: "billing",
    canonicalQuestion: "How do I upgrade or downgrade my plan?",
    body:
      "You can change your plan yourself from Settings -> Billing. Open the dashboard, go to Settings, then the " +
      "Billing tab, and choose a different tier. An upgrade takes effect immediately and you are charged a " +
      "prorated amount for the rest of the current billing period. A downgrade takes effect at the end of the " +
      "current billing period, so you keep your current plan's limits until then. Your AI credit allowance " +
      "changes to match the new plan on the date the change takes effect.",
  },
  {
    title: "How AI credits work",
    knowledgeType: "faq",
    visibility: "customer",
    category: "credits",
    canonicalQuestion: "What are AI credits and how are they consumed?",
    body:
      "Every plan includes a monthly AI credit allowance (Free 500, Pro 10,000, Elite 50,000, Enterprise " +
      "500,000). Credits are consumed by AI features such as the Assistant, Market Intelligence analysis, and " +
      "agent runs. The allowance resets at the start of each billing period and unused credits do not roll " +
      "over. When you reach your limit, AI features are paused until the next reset or until you upgrade. You " +
      "can see current usage on the Billing dashboard.",
  },
  {
    title: "Refund policy",
    knowledgeType: "policy",
    visibility: "customer",
    category: "policies",
    canonicalQuestion: "Can I get a refund on my subscription or a marketplace purchase?",
    body:
      "Subscription payments are billed in advance and are non-refundable for the current period; you can " +
      "cancel at any time to stop future charges, and you keep access until the end of the paid period. " +
      "Marketplace product purchases may be refunded within 14 days of purchase if the product has not been " +
      "activated on a live account and is materially not as described. Refund requests are reviewed by a human " +
      "and are not automatic - contact support with your purchase reference.",
  },
  {
    title: "Marketplace purchases and licenses",
    knowledgeType: "support",
    visibility: "customer",
    category: "licenses",
    canonicalQuestion: "How do product licenses and activations work after I buy?",
    body:
      "When a marketplace purchase completes, an entitlement and a license are issued to your account. The " +
      "license controls how many devices (activations) you can run the product on, shown as its activation " +
      "policy. You can view your licenses and their status on the Licenses page. A license can be ISSUED, " +
      "ACTIVE, SUSPENDED, EXPIRED or REVOKED. If a license shows SUSPENDED or REVOKED unexpectedly, or you " +
      "need to move an activation to a new device beyond the allowed count, contact support.",
  },
  {
    title: "Supported platforms for AT24 products",
    knowledgeType: "product",
    visibility: "public",
    category: "products",
    canonicalQuestion: "Which trading platforms do AT24 products run on?",
    body:
      "AT24 marketplace products target MetaTrader 5 (MT5) and MetaTrader 4 (MT4) as Expert Advisors, plus a " +
      "smaller number of TradingView Pine Script strategies and cTrader / NinjaTrader builds. Each listing " +
      "states its supported platforms explicitly on the product page. A product built for one platform does " +
      "not run on another; check the listing's Supported Platforms field before purchasing.",
  },
  {
    title: "Password reset and sign-in problems",
    knowledgeType: "support",
    visibility: "public",
    category: "troubleshooting",
    canonicalQuestion: "I cannot sign in or reset my password - what do I do?",
    body:
      "Use the 'Forgot password' link on the sign-in page to request a reset email. The email is sent to your " +
      "registered address; check spam if it does not arrive within a few minutes. If you signed up with Google, " +
      "use 'Continue with Google' rather than a password. If your account is locked, the reset email does not " +
      "arrive, or your email address has changed and you cannot receive it, contact support - an agent cannot " +
      "change your password or email for you, but human support can verify your identity and help.",
  },
  {
    title: "Verified resolution: analysis stuck on a symbol",
    knowledgeType: "support",
    visibility: "customer",
    category: "verified-resolutions",
    canonicalQuestion: "Market Intelligence analysis stays 'not available' for a symbol - is this a bug?",
    body:
      "For several instruments the platform will honestly report 'not available' rather than show a number. " +
      "This is expected when the upstream data provider does not cover that symbol on the current data key " +
      "(this affects some metals and less-liquid pairs) or when there is not enough recent data to compute a " +
      "regime. It is not a fault on your account and upgrading your plan does not change it. EURUSD and the " +
      "major supported symbols work; the workspace lists which instruments are fully covered.",
  },
  {
    title: "What the Support Assistant can and cannot do",
    knowledgeType: "policy",
    visibility: "customer",
    category: "policies",
    canonicalQuestion: "Can the Support Assistant change my billing or cancel my subscription?",
    body:
      "The Support Assistant is read-only. It can look up published support articles and the status of your " +
      "own plan, subscription, purchases and licenses, and it cites everything it tells you. It cannot cancel " +
      "or change a subscription, issue a refund, move a license activation, reset a password, or change any " +
      "account setting. When you ask for one of those, or when it has no answer, it hands the request to human " +
      "support. It is not a financial adviser and does not give trading advice.",
  },
];

async function resolveActor(): Promise<{ id: string; email: string }> {
  const admin = await prisma.user.findFirst({
    where: { role: "admin", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (admin) return { id: admin.id, email: admin.email };
  const anyUser = await prisma.user.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  if (anyUser) return { id: anyUser.id, email: anyUser.email };
  const created = await prisma.user.create({
    data: { email: "support-kb-author@algotraders24.ai", name: "Support KB Author", role: "admin", emailVerified: true },
  });
  return { id: created.id, email: created.email };
}

async function main(): Promise<void> {
  console.log("\nCS1 - seeding the SUPPORT knowledge corpus\n");
  const actor = await resolveActor();
  console.log(`  author/actor: ${actor.email}`);

  // idempotency: drop prior seed rows (chunks + embeddings cascade on delete).
  const prior = await prisma.knowledge.findMany({
    where: { scope: "support", source: SEED_MARKER },
    select: { id: true },
  });
  if (prior.length > 0) {
    await prisma.knowledge.deleteMany({ where: { id: { in: prior.map((p) => p.id) } } });
    console.log(`  removed ${prior.length} previously-seeded support row(s)`);
  }

  const service = await createKnowledgeService({ withRetrievalCache: false });
  const ingestion = realIngestionPort();

  let ok = 0;
  let reindex = 0;
  for (const doc of DOCS) {
    const draft = await service.create({
      userId: actor.id,
      title: doc.title,
      description: doc.canonicalQuestion,
      category: doc.category,
      canonicalQuestion: doc.canonicalQuestion,
      canonicalAnswer: doc.body,
      knowledgeType: doc.knowledgeType,
      scope: "support",
      visibility: doc.visibility,
      source: SEED_MARKER,
      sourceType: "admin_authored",
      provenance: { origin: "admin-authored", createdBy: actor.id, createdAt: new Date().toISOString() },
      confidence: 0.9,
      freshnessClass: "PERIODIC",
      freshnessReviewEveryDays: 90,
    });

    const res = await publishKnowledge(service, ingestion, {
      knowledgeId: draft.id,
      actorId: actor.id,
      body: doc.body,
      confidence: 0.9,
    });
    ok += 1;
    if (res.reindexNeeded) reindex += 1;
    console.log(
      `  + ${doc.knowledgeType.padEnd(8)} ${doc.title}  ->  ${res.ingestion.chunksCreated} chunk(s), ` +
        `${res.ingestion.embeddingsStored} embedded${res.reindexNeeded ? " (REINDEX NEEDED)" : ""}`,
    );
  }

  console.log(`\n  ${ok}/${DOCS.length} support rows active.` + (reindex > 0 ? ` ${reindex} need re-embedding (provider issue).` : ""));
  console.log("  Support Agent retrieval: searchSimilar({ scopes: ['support'], visibilities: ['public','customer'] })\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("seed-support-kb failed:", err);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
