// app/contest/page.tsx - /contest goes to the open contest (or the finished latest one), else to the demo page.
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ContestIndex() {
  const c =
    (await prisma.contest.findFirst({ where: { status: "OPEN" }, orderBy: { endsAt: "asc" } }).catch(() => null)) ??
    (await prisma.contest.findFirst({ where: { status: { in: ["CLOSED", "FINALIZED"] } }, orderBy: { endsAt: "desc" } }).catch(() => null));
  redirect(c ? `/contest/${c.slug}` : "/demo");
}
