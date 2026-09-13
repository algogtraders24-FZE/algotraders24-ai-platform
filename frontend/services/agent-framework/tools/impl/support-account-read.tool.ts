// services/agent-framework/tools/impl/support-account-read.tool.ts
// AT24 Agent Framework - CS1. Tool: support.account_read
//
// A THIN, READ-ONLY adapter over the existing billing / marketplace tables.
// It answers exactly one question for the Support Agent: "what is the
// STATUS of the REQUESTING user's own plan, subscription, purchases and
// licenses?" - so the agent can give an account-aware answer or decide it
// needs a human.
//
// LOCKED (CS1.2 D4): STATUS FIELDS ONLY. This tool never returns, and its
// output/evidence must never carry:
//   - a license `apiKeyHash` / `signature` / raw key
//   - a payment provider ref (`stripeSubscriptionId`, `nowPaymentsInvoiceId`,
//     `providerRef`)
//   - a monetary amount
// It reads by `ctx.userId` (server session) ONLY - there is no input that
// selects a user. It performs NO writes.

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";

type AccountDomain = "plan" | "subscription" | "purchases" | "licenses";
const ALL_DOMAINS: AccountDomain[] = ["plan", "subscription", "purchases", "licenses"];

interface SupportAccountReadInput {
  /** Optional filter; default = every domain. */
  domains?: AccountDomain[];
}

interface AccountSnapshot {
  plan: { planId: string; accountStatus: string } | null;
  subscription: {
    planId: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasPaymentProvider: boolean;
  } | null;
  purchases: { listingTitle: string; status: string; purchasedAt: string; licenseStatus: string | null; platform: string | null }[];
  licenses: { tradingSystemId: string; licenseStatus: string; platform: string; issuedAt: string; expiresAt: string | null }[];
}

const definition: ToolDefinition = {
  id: "support.account_read",
  name: "Support Account Read",
  description:
    "Read-only status of the REQUESTING user's own account: plan tier, subscription status, purchase " +
    "history status and license status. Never returns secrets, provider references or monetary amounts. " +
    "Scoped to the session user; cannot read another user.",
  version: "1.0.0",
  category: "ACCOUNT",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      domains: {
        type: "array",
        items: { type: "string", enum: ALL_DOMAINS },
      },
    },
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_READ_ACCOUNT_RECORDS"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("support.account_read") },
  executionMode: "sync",
  // CS1.2 D2 (NO MIGRATION): AgentEvidenceType is a Postgres enum; an account
  // status fact reuses "derived". The discriminator is `source` ("account:*")
  // and `provenance.producer` ("account-records-read"), never a new enum value.
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["derived"],
    provenanceProducer: "account-records-read",
  },
  status: "active",
  wraps: "lib/prisma.ts (User / Subscription / Purchase / License reads) - read-only, session-user-scoped",
};

function parseInput(raw: unknown): ToolInputParseResult<SupportAccountReadInput> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  if (raw.domains === undefined) return { ok: true, value: {} };
  if (!Array.isArray(raw.domains) || raw.domains.some((d) => !ALL_DOMAINS.includes(d as AccountDomain))) {
    return { ok: false, violations: [{ path: "domains", message: `domains must be a subset of: ${ALL_DOMAINS.join(", ")}.` }] };
  }
  return { ok: true, value: { domains: raw.domains as AccountDomain[] } };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (!("snapshot" in value)) return contractResult([{ path: "snapshot", message: "output.snapshot is required." }]);
  return contractOk();
}

/** One evidence row per populated domain - each a status-only fact. */
function toEvidence(snapshot: AccountSnapshot, domains: AccountDomain[]): AgentEvidenceDraft[] {
  const now = new Date().toISOString();
  const out: AgentEvidenceDraft[] = [];
  const mk = (domain: AccountDomain, claim: string, data: unknown): AgentEvidenceDraft => ({
    type: "derived", // CS1.2 D2 - reused enum; "account:" source + producer are the discriminator
    claim,
    source: `account:${domain}`,
    sourceId: `account:${domain}`,
    timestamp: now,
    data,
    relevance: 0.9,
    confidence: 1,
    provenance: { producer: "account-records-read", retrievedAt: now },
  });

  if (domains.includes("plan") && snapshot.plan) {
    out.push(mk("plan", `Account plan tier is "${snapshot.plan.planId}"; account status "${snapshot.plan.accountStatus}".`, snapshot.plan));
  }
  if (domains.includes("subscription") && snapshot.subscription) {
    const s = snapshot.subscription;
    out.push(
      mk(
        "subscription",
        `Subscription to "${s.planId}" is "${s.status}"` +
          `${s.cancelAtPeriodEnd ? " (set to cancel at period end)" : ""}` +
          `${s.currentPeriodEnd ? `; current period ends ${s.currentPeriodEnd.slice(0, 10)}` : ""}.`,
        s,
      ),
    );
  }
  if (domains.includes("purchases")) {
    out.push(
      mk(
        "purchases",
        snapshot.purchases.length === 0
          ? "No marketplace purchases on record for this account."
          : `${snapshot.purchases.length} marketplace purchase(s) on record: ` +
            snapshot.purchases.map((p) => `"${p.listingTitle}" (${p.status}${p.licenseStatus ? `, license ${p.licenseStatus}` : ""})`).join("; ") + ".",
        { purchases: snapshot.purchases },
      ),
    );
  }
  if (domains.includes("licenses")) {
    out.push(
      mk(
        "licenses",
        snapshot.licenses.length === 0
          ? "No product licenses issued to this account."
          : `${snapshot.licenses.length} license(s): ` +
            snapshot.licenses.map((l) => `${l.tradingSystemId} on ${l.platform} - ${l.licenseStatus}`).join("; ") + ".",
        { licenses: snapshot.licenses },
      ),
    );
  }
  return out;
}

export const supportAccountReadTool: ToolImplementation<
  SupportAccountReadInput,
  { snapshot: AccountSnapshot; domains: AccountDomain[] }
> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input, ctx) {
    const domains = input.domains && input.domains.length > 0 ? input.domains : ALL_DOMAINS;
    const { prisma } = await import("@/lib/prisma");

    const snapshot: AccountSnapshot = { plan: null, subscription: null, purchases: [], licenses: [] };

    if (domains.includes("plan")) {
      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { planId: true, status: true },
      });
      if (user) snapshot.plan = { planId: user.planId ?? "free", accountStatus: user.status ?? "unknown" };
    }

    if (domains.includes("subscription")) {
      const sub = await prisma.subscription.findFirst({
        where: { userId: ctx.userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { planId: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, provider: true },
      });
      if (sub) {
        snapshot.subscription = {
          planId: sub.planId,
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          hasPaymentProvider: sub.provider != null, // boolean only - never the provider name/ref
        };
      }
    }

    if (domains.includes("purchases") || domains.includes("licenses")) {
      const purchases = await prisma.purchase.findMany({
        where: { buyerId: ctx.userId, deletedAt: null },
        orderBy: { purchasedAt: "desc" },
        include: { entitlements: { include: { licenses: true } } },
      });
      const listingIds = [...new Set(purchases.map((p) => p.marketplaceListingId))];
      const listings = await prisma.marketplaceListing.findMany({
        where: { id: { in: listingIds } },
        select: { id: true, title: true },
      });
      const titleById = new Map(listings.map((l) => [l.id, l.title]));

      if (domains.includes("purchases")) {
        snapshot.purchases = purchases.map((p) => {
          const lic = p.entitlements[0]?.licenses[0];
          return {
            listingTitle: titleById.get(p.marketplaceListingId) ?? "(listing unavailable)",
            status: p.status,
            purchasedAt: p.purchasedAt.toISOString(),
            licenseStatus: lic?.licenseStatus ?? null,
            platform: lic?.platform ?? null,
          };
        });
      }
      if (domains.includes("licenses")) {
        snapshot.licenses = purchases.flatMap((p) =>
          p.entitlements.flatMap((e) =>
            e.licenses.map((l) => ({
              tradingSystemId: l.tradingSystemId,
              licenseStatus: l.licenseStatus,
              platform: l.platform,
              issuedAt: l.issuedAt.toISOString(),
              expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
            })),
          ),
        );
      }
    }

    return { output: { snapshot, domains }, evidence: toEvidence(snapshot, domains) };
  },
};
