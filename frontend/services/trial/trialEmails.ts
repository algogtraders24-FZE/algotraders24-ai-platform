// services/trial/trialEmails.ts
// The trial's onboarding emails: WELCOME (right after the demo starts), D7, D24 (6 days left) and D31 (ended).
// Sent from support@ with the same signed unsubscribe link as announcements; an opted-out user gets nothing. Each (licence, step) is
// claimed in TrialEmailLog BEFORE sending, so the daily job (or a retry) can never email the same step twice.
// Honest by design: demo is not live, risk is real, no profit claims (validateAnnouncement also runs the content policy check).
import "server-only";
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/payments/env";
import { sendLifecycleEmail, validateAnnouncement } from "@/services/announcements/service";
import type { AnnouncementContent } from "@/services/announcements/render";
import { TRIAL_PRODUCTS } from "@/services/trial/trialService";

export type TrialStep = "WELCOME" | "D7" | "D24" | "D31";

export interface TrialEmailInput {
  userId: string;
  email: string;
  licenseId: string;
  productId: string;
  expiresAt: string;
}

async function openContest(productId: string) {
  return prisma.contest.findFirst({ where: { tradingSystemId: productId, status: "OPEN" }, orderBy: { endsAt: "asc" } });
}

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export async function buildTrialEmail(step: TrialStep, i: TrialEmailInput): Promise<AnnouncementContent> {
  const product = TRIAL_PRODUCTS[i.productId];
  const name = product?.title ?? i.productId;
  const site = getSiteUrl().replace(/\/$/, "");
  const myDemo = `${site}/dashboard/purchases/${i.licenseId}`;
  const contest = await openContest(i.productId);
  const contestLine = contest
    ? `\n\n**Demo contest (optional)**\n\n${contest.title} runs ${day(contest.startsAt.toISOString())} to ${day(contest.endsAt.toISOString())}. The top 3 win a ${contest.prizeMonths}-month licence and everyone who takes part gets ${contest.offerPercent}% off. Details and rules: ${site}/contest/${contest.slug}`
    : "";

  if (step === "WELCOME") {
    return {
      subject: `Your 30-day ${name} demo is ready`,
      preheader: "Download the demo, paste your key, run it on a demo account.",
      bodyText:
        `Hi,\n\nYour free 30-day demo of **${name}** is ready. It runs on a **demo account only**.\n\n**Start in 3 steps**\n\n` +
        `- Open your demo page and download the demo EA (button below). Your licence key is on the same page.\n` +
        `- MetaTrader 5: Tools > Options > Expert Advisors > allow WebRequest for https://www.algotraders24.ai\n` +
        `- Attach the EA to a US30 chart of your DEMO account, paste the key into InpLicenseKey and start with a small lot.\n\n` +
        `Your demo works until ${day(i.expiresAt)} on one trading account. Optional but useful: connect that demo account to AT24 Live Sync (Dashboard > Live Sync, free) to get your own results page.` +
        contestLine +
        `\n\nA demo is not live trading: spread, slippage and commission on a real account are different, and results can be worse. Past results do not predict future results.\n\nQuestions? Reply to this email - it goes straight to our support team.\n\nThe Algotraders24 team`,
      ctaLabel: "Open my demo",
      ctaUrl: myDemo,
    };
  }
  if (step === "D7") {
    return {
      subject: `One week into your ${name} demo`,
      preheader: "A quick check that everything is running, and how to see your own results.",
      bodyText:
        `Hi,\n\nYou are a week into your ${name} demo - a good time for a quick check.\n\n- Is the EA attached to a US30 chart, with Algo Trading on and a small lot?\n- The chart panel and the Experts tab should show the licence as OK.\n- Connect your demo account to AT24 Live Sync (free) to see your own results page, with the trades and rule checks.\n\n` +
        `Let it run for the full 30 days without changing the settings, so you can judge it fairly.` +
        contestLine +
        `\n\nStuck? Just reply to this email.\n\nThe Algotraders24 team`,
      ctaLabel: "Open my demo",
      ctaUrl: myDemo,
    };
  }
  if (step === "D24") {
    return {
      subject: `Your ${name} demo ends in 6 days`,
      preheader: "Check your results, and what you can do next.",
      bodyText:
        `Hi,\n\nYour ${name} demo ends on ${day(i.expiresAt)}. When it ends the EA stops opening new trades; trades that are already open are still managed.\n\n` +
        `Before it ends, look at your own results page (Live Sync) and judge the demo the way you would judge any system: over the whole period, including the weak days.` +
        (contest ? `\n\nIf you joined the demo contest, everyone who took part gets ${contest.offerPercent}% off - you will find it on the contest page.` : "") +
        `\n\nA demo is not live trading, and results on a real account can be different. Trading is risky.\n\nThe Algotraders24 team`,
      ctaLabel: "See my demo",
      ctaUrl: myDemo,
    };
  }
  return {
    subject: `Your ${name} demo has ended`,
    preheader: "Thanks for trying it - here is what comes next.",
    bodyText:
      `Hi,\n\nYour 30-day ${name} demo has ended - thank you for trying it.\n\n` +
      `If you want to keep using the product, the full version is on the marketplace, with the full evidence and its weak points shown on the page.` +
      (contest ? `\n\nTook part in the demo contest? Your ${contest.offerPercent}% offer is on the contest page.` : "") +
      `\n\nNot for you? No problem - your feedback helps us: just reply and tell us why.\n\nThe Algotraders24 team`,
    ctaLabel: `View ${name}`,
    ctaUrl: `${site}/marketplace/${product?.listingSlug ?? ""}`,
  };
}

/** Claims the step, sends the email, and returns what happened. Never throws for "already sent" / opted out. */
export async function sendTrialEmail(step: TrialStep, i: TrialEmailInput): Promise<"sent" | "already" | "opted_out" | "failed"> {
  const optOut = await prisma.emailOptOut.findUnique({ where: { userId: i.userId } });
  if (optOut) return "opted_out";
  try {
    await prisma.trialEmailLog.create({ data: { licenseId: i.licenseId, step } });
  } catch {
    return "already"; // unique (licenseId, step): someone already claimed this step
  }
  try {
    const content = await buildTrialEmail(step, i);
    const bad = validateAnnouncement(content);
    if (bad) throw new Error(bad);
    const err = await sendLifecycleEmail(i.userId, i.email, content);
    if (err) throw new Error(err);
    return "sent";
  } catch {
    await prisma.trialEmailLog.deleteMany({ where: { licenseId: i.licenseId, step } }); // let the next run retry
    return "failed";
  }
}

const DAY = 24 * 3600 * 1000;

/** The daily job: for every trial licence, send the steps that are due and not yet sent. Returns counters. */
export async function runTrialDrip(now: Date = new Date(), limit = 150): Promise<{ checked: number; sent: number; failed: number }> {
  const trials = await prisma.purchase.findMany({
    where: { provider: "TRIAL", deletedAt: null, purchasedAt: { gte: new Date(now.getTime() - 40 * DAY) } },
    include: { entitlements: { include: { licenses: true } } },
    take: 1000,
  });
  let checked = 0, sent = 0, failed = 0;
  for (const p of trials) {
    const lic = p.entitlements[0]?.licenses[0];
    if (!lic || lic.licenseStatus === "REVOKED" || !lic.expiresAt) continue;
    checked++;
    const ageDays = Math.floor((now.getTime() - lic.issuedAt.getTime()) / DAY);
    const due: TrialStep[] = [];
    if (ageDays >= 7) due.push("D7");
    if (ageDays >= 24) due.push("D24");
    if (ageDays >= 31) due.push("D31");
    // Only the LATEST due step is sent (a user who joined late is not flooded), and never one that already went out.
    const step = due[due.length - 1];
    if (!step) continue;
    const done = await prisma.trialEmailLog.findMany({ where: { licenseId: lic.id }, select: { step: true } });
    if (done.some((d) => d.step === step)) continue;
    if (sent + failed >= limit) break;
    const user = await prisma.user.findUnique({ where: { id: p.buyerId }, select: { email: true, status: true, deletedAt: true } });
    if (!user || user.deletedAt || user.status !== "active" || /@internal\.test$/i.test(user.email)) continue;
    const r = await sendTrialEmail(step, { userId: p.buyerId, email: user.email, licenseId: lic.id, productId: p.tradingSystemId, expiresAt: lic.expiresAt.toISOString() });
    if (r === "sent") sent++;
    else if (r === "failed") failed++;
  }
  return { checked, sent, failed };
}
