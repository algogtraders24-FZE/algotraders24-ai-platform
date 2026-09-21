// lib/security/getClientIp.ts
// Sprint R1.3 - Best-effort client IP for server actions. Vercel (and most
// proxies) set x-forwarded-for as "client, proxy1, proxy2..." - the first
// entry is the original client. Falls back to x-real-ip, then "unknown" so
// callers always get a stable grouping key rather than throwing.
import { headers } from "next/headers";

export async function getClientIp(): Promise<string> {
  const headerList = await headers();

  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headerList.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}
