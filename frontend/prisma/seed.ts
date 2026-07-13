// prisma/seed.ts
// Sprint 14D Phase 1 - Comprehensive seed script.
// Idempotent: safe to run repeatedly. Uses upsert / delete-then-insert per entity.
// Links demo data to the first real (Supabase-authenticated) user when one exists,
// otherwise provisions a demo user so the dashboard has data to render.
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function seedPlans() {
  const plans = [
    { id: "free", name: "Free", price: 0, interval: "month", sortOrder: 1, features: ["1 AI agent", "100 messages / month", "Community support"] },
    { id: "pro", name: "Pro", price: 49, interval: "month", sortOrder: 2, features: ["10 AI agents", "Unlimited messages", "Knowledge base", "Email support"] },
    { id: "elite", name: "Elite", price: 149, interval: "month", sortOrder: 3, features: ["Unlimited agents", "Automation workflows", "Trading Copilot", "Priority support"] },
    { id: "enterprise", name: "Enterprise", price: 499, interval: "month", sortOrder: 4, features: ["Everything in Elite", "Dedicated infrastructure", "SLA", "Account manager"] },
  ];

  for (const p of plans) {
    await prisma.plan.upsert({
      where: { id: p.id },
      update: { name: p.name, price: p.price, interval: p.interval, sortOrder: p.sortOrder, features: p.features, isActive: true },
      create: { ...p, isActive: true },
    });
  }
  console.log(`  plans: ${plans.length} upserted`);
}

async function resolveOwner(): Promise<{ id: string; email: string }> {
  // Prefer a real authenticated user (created by Supabase Auth in Sprint 14C).
  const real = await prisma.user.findFirst({
    where: { authId: { not: null }, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (real) {
    console.log(`  owner: existing authenticated user ${real.email}`);
    return { id: real.id, email: real.email };
  }

  const demo = await prisma.user.upsert({
    where: { email: "demo@algotraders24.ai" },
    update: {},
    create: {
      email: "demo@algotraders24.ai",
      name: "Demo Trader",
      role: "user",
      planId: "pro",
      status: "active",
      emailVerified: true,
    },
  });
  console.log(`  owner: demo user ${demo.email}`);
  return { id: demo.id, email: demo.email };
}

async function seedAdmin() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@algotraders24.ai" },
    update: { role: "admin", planId: "enterprise", status: "active" },
    create: {
      email: "admin@algotraders24.ai",
      name: "Platform Admin",
      role: "admin",
      planId: "enterprise",
      status: "active",
      emailVerified: true,
    },
  });
  console.log(`  admin: ${admin.email}`);
}

async function seedProducts() {
  const products = [
    { slug: "ai-trend-master-ea", name: "AI Trend Master EA", price: 299, status: "active" },
    { slug: "quantum-scalper-pro", name: "Quantum Scalper Pro", price: 499, status: "active" },
    { slug: "axon-signal-engine", name: "Axon Signal Engine", price: 199, status: "active" },
    { slug: "volatility-shield", name: "Volatility Shield", price: 149, status: "draft" },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: { name: p.name, price: p.price, status: p.status, deletedAt: null },
      create: p,
    });
  }
  console.log(`  products: ${products.length} upserted`);
}

async function seedUserScopedData(ownerId: string) {
  // Replace prior demo rows for this owner so repeated runs stay clean.
  await prisma.agent.deleteMany({ where: { userId: ownerId } });
  await prisma.knowledge.deleteMany({ where: { userId: ownerId } });
  await prisma.automation.deleteMany({ where: { userId: ownerId } });
  await prisma.conversation.deleteMany({ where: { userId: ownerId } });
  await prisma.billing.deleteMany({ where: { userId: ownerId } });
  await prisma.subscription.deleteMany({ where: { userId: ownerId } });

  await prisma.agent.createMany({
    data: [
      { userId: ownerId, name: "Market Analyst", type: "analysis", status: "active" },
      { userId: ownerId, name: "Risk Sentinel", type: "risk", status: "active" },
      { userId: ownerId, name: "News Digest Bot", type: "research", status: "paused" },
    ],
  });

  await prisma.knowledge.createMany({
    data: [
      { userId: ownerId, title: "Trading Strategy Handbook", source: "handbook.pdf", chunkCount: 142, status: "indexed" },
      { userId: ownerId, title: "Risk Management Guide", source: "risk-guide.pdf", chunkCount: 87, status: "indexed" },
      { userId: ownerId, title: "Q1 Market Outlook", source: "outlook-q1.docx", chunkCount: 0, status: "processing" },
    ],
  });

  await prisma.automation.createMany({
    data: [
      { userId: ownerId, name: "Daily Market Digest", trigger: "schedule:daily", enabled: true },
      { userId: ownerId, name: "Drawdown Alert", trigger: "event:drawdown", enabled: true },
      { userId: ownerId, name: "Weekly Performance Report", trigger: "schedule:weekly", enabled: false },
    ],
  });

  const now = Date.now();
  await prisma.conversation.createMany({
    data: [
      { userId: ownerId, title: "EURUSD setup review", messageCount: 14, lastMessageAt: new Date(now - 2 * 3600_000) },
      { userId: ownerId, title: "Backtest interpretation", messageCount: 8, lastMessageAt: new Date(now - 26 * 3600_000) },
      { userId: ownerId, title: "Position sizing questions", messageCount: 21, lastMessageAt: new Date(now - 72 * 3600_000) },
    ],
  });

  await prisma.billing.createMany({
    data: [
      { userId: ownerId, planId: "pro", status: "active", amount: 49 },
      { userId: ownerId, planId: "pro", status: "active", amount: 49 },
      { userId: ownerId, planId: "free", status: "canceled", amount: 0 },
    ],
  });

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.subscription.create({
    data: {
      userId: ownerId,
      planId: "pro",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    },
  });

  console.log("  agents: 3, knowledge: 3, automations: 3, conversations: 3, billing: 3, subscription: 1");
}

async function main() {
  console.log("Seeding database...");
  await seedPlans();
  await seedAdmin();
  await seedProducts();
  const owner = await resolveOwner();
  await seedUserScopedData(owner.id);
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });