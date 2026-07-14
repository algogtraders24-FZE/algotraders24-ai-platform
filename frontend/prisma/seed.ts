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
    { id: "free", name: "Free", price: 0, interval: "month", sortOrder: 1, features: ["500 AI credits / month", "1 AI agent", "2 automations", "10 knowledge documents", "100 MB storage", "Community support"] },
    { id: "pro", name: "Pro", price: 29, interval: "month", sortOrder: 2, features: ["10,000 AI credits / month", "5 AI agents", "25 automations", "200 knowledge documents", "5 GB storage", "API access", "3 team members"] },
    { id: "elite", name: "Elite", price: 99, interval: "month", sortOrder: 3, features: ["50,000 AI credits / month", "20 AI agents", "100 automations", "1,000 knowledge documents", "25 GB storage", "API access", "Priority support", "Custom branding", "10 team members"] },
    { id: "enterprise", name: "Enterprise", price: 499, interval: "month", sortOrder: 4, features: ["500,000 AI credits / month", "100 AI agents", "1,000 automations", "Unlimited knowledge documents", "500 GB storage", "API access", "Dedicated support & SLA", "Custom branding", "100 team members"] },
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
  const { PRODUCTS } = await import("../data/products");

  for (const p of PRODUCTS) {
    const data = {
      slug: p.slug,
      name: p.name,
      shortDescription: p.shortDescription,
      fullDescription: p.fullDescription,
      category: p.category,
      platform: p.platform,
      supportedPlatforms: p.supportedPlatforms,
      tags: p.tags,
      price: p.price,
      currency: p.currency,
      images: p.images,
      features: p.features,
      specifications: p.specifications as unknown as object,
      faqs: (p.faqs ?? []) as unknown as object,
      version: p.version,
      releaseDate: p.releaseDate,
      lastUpdated: p.lastUpdated,
      rating: p.rating,
      downloads: p.downloads,
      featured: p.featured,
      status: p.status,
      deletedAt: null,
    };

    await prisma.product.upsert({
      where: { slug: p.slug },
      update: data,
      create: data,
    });
  }
  console.log(`  products: ${PRODUCTS.length} upserted (full catalogue)`);
}

async function seedUserScopedData(ownerId: string) {
  // Replace prior demo rows for this owner so repeated runs stay clean.
  await prisma.agent.deleteMany({ where: { userId: ownerId } });
  await prisma.knowledge.deleteMany({ where: { userId: ownerId } });
  await prisma.automation.deleteMany({ where: { userId: ownerId } });
  await prisma.conversation.deleteMany({ where: { userId: ownerId } });
  await prisma.billing.deleteMany({ where: { userId: ownerId } });
  await prisma.subscription.deleteMany({ where: { userId: ownerId } });

  await prisma.agentTask.deleteMany({ where: { userId: ownerId } });
  await prisma.agentMemory.deleteMany({ where: { userId: ownerId } });
  await prisma.agentActivity.deleteMany({ where: { userId: ownerId } });

  const agentSeed = [
    {
      type: "market-analyst",
      name: "Market Analyst",
      description: "Scans price action and macro signals to summarise market conditions.",
      avatar: "MA",
      status: "running",
      goal: "Produce a daily read on trend, volatility and key levels.",
      priority: 1,
      tools: ["web-search", "chart-reader", "news-feed"],
      capabilities: ["Trend analysis", "Volatility read", "Level mapping"],
      tasksCompleted: 128,
      successRate: 94,
      estimatedCost: 3.4,
    },
    {
      type: "risk-manager",
      name: "Risk Sentinel",
      description: "Monitors exposure, drawdown and position sizing against limits.",
      avatar: "RS",
      status: "idle",
      goal: "Keep portfolio risk inside configured limits.",
      priority: 1,
      tools: ["portfolio-reader", "alerting"],
      capabilities: ["Drawdown watch", "Exposure limits", "Sizing checks"],
      tasksCompleted: 76,
      successRate: 98,
      estimatedCost: 1.2,
    },
    {
      type: "news-researcher",
      name: "News Digest Bot",
      description: "Collects and condenses market-moving headlines.",
      avatar: "ND",
      status: "paused",
      goal: "Deliver a concise digest of relevant market news.",
      priority: 3,
      tools: ["news-feed", "web-search"],
      capabilities: ["Headline scan", "Summarisation"],
      tasksCompleted: 41,
      successRate: 88,
      estimatedCost: 0.9,
    },
  ];

  const nowAgent = new Date();
  const createdAgents = [];
  for (const a of agentSeed) {
    const created = await prisma.agent.create({
      data: {
        userId: ownerId,
        type: a.type,
        name: a.name,
        description: a.description,
        avatar: a.avatar,
        status: a.status,
        provider: "gemini",
        version: "1.0.0",
        memoryEnabled: true,
        tools: a.tools,
        capabilities: a.capabilities,
        goal: a.goal,
        priority: a.priority,
        lastRun: a.status === "paused" ? null : nowAgent,
        nextRun: a.status === "paused" ? null : new Date(nowAgent.getTime() + 3600_000),
        tasksCompleted: a.tasksCompleted,
        successRate: a.successRate,
        estimatedCost: a.estimatedCost,
      },
    });
    createdAgents.push(created);
  }

  const analyst = createdAgents[0];
  const sentinel = createdAgents[1];

  await prisma.agentTask.createMany({
    data: [
      { agentId: analyst.id, userId: ownerId, title: "Summarise overnight session", status: "done", finishedAt: new Date(nowAgent.getTime() - 3600_000) },
      { agentId: analyst.id, userId: ownerId, title: "Map key EURUSD levels", status: "running", finishedAt: null },
      { agentId: sentinel.id, userId: ownerId, title: "Check open exposure vs limits", status: "queued", finishedAt: null },
    ],
  });

  await prisma.agentMemory.createMany({
    data: [
      { agentId: analyst.id, userId: ownerId, key: "preferred_pairs", value: "EURUSD, XAUUSD" },
      { agentId: analyst.id, userId: ownerId, key: "session_focus", value: "London open" },
      { agentId: sentinel.id, userId: ownerId, key: "max_drawdown_pct", value: "8" },
    ],
  });

  await prisma.agentActivity.createMany({
    data: [
      { agentId: analyst.id, userId: ownerId, message: "Completed overnight session summary." },
      { agentId: sentinel.id, userId: ownerId, message: "Exposure within limits (4.2% of equity)." },
      { agentId: analyst.id, userId: ownerId, message: "Detected volatility expansion on XAUUSD." },
    ],
  });

  // Collections first, so documents can reference them.
  await prisma.knowledgeCollection.deleteMany({ where: { userId: ownerId } });
  const strategyCol = await prisma.knowledgeCollection.create({
    data: { userId: ownerId, name: "Trading Strategies", description: "Strategy playbooks and system rules." },
  });
  const riskCol = await prisma.knowledgeCollection.create({
    data: { userId: ownerId, name: "Risk & Compliance", description: "Risk frameworks and operating limits." },
  });
  const researchCol = await prisma.knowledgeCollection.create({
    data: { userId: ownerId, name: "Market Research", description: "Outlooks, notes and market analysis." },
  });

  const nowTs = new Date();
  await prisma.knowledge.createMany({
    data: [
      {
        userId: ownerId,
        title: "Trading Strategy Handbook",
        description: "Core playbook covering entries, exits and position management.",
        category: "Trading Strategies",
        collectionId: strategyCol.id,
        author: "Research Desk",
        tags: ["strategy", "playbook", "entries"],
        provider: "gemini",
        language: "en",
        fileType: "pdf",
        documentSize: 2_450_000,
        source: "handbook.pdf",
        chunkCount: 142,
        status: "indexed",
        embeddingStatus: "embedded",
        lastIndexed: nowTs,
        retrievalCount: 48,
        popularity: 92,
      },
      {
        userId: ownerId,
        title: "Risk Management Guide",
        description: "Drawdown limits, sizing rules and exposure controls.",
        category: "Risk Management",
        collectionId: riskCol.id,
        author: "Risk Team",
        tags: ["risk", "drawdown", "sizing"],
        provider: "gemini",
        language: "en",
        fileType: "pdf",
        documentSize: 1_180_000,
        source: "risk-guide.pdf",
        chunkCount: 87,
        status: "indexed",
        embeddingStatus: "embedded",
        lastIndexed: nowTs,
        retrievalCount: 31,
        popularity: 78,
      },
      {
        userId: ownerId,
        title: "Q1 Market Outlook",
        description: "Quarterly macro outlook and positioning notes.",
        category: "Market Structure",
        collectionId: researchCol.id,
        author: "Research Desk",
        tags: ["macro", "outlook", "q1"],
        provider: "gemini",
        language: "en",
        fileType: "md",
        documentSize: 340_000,
        source: "outlook-q1.docx",
        chunkCount: 0,
        status: "processing",
        embeddingStatus: "pending",
        lastIndexed: null,
        retrievalCount: 0,
        popularity: 12,
      },
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
      { userId: ownerId, planId: "pro", status: "active", amount: 29 },
      { userId: ownerId, planId: "pro", status: "active", amount: 29 },
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