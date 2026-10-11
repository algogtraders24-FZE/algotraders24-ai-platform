// app/api/private/rewards/contracts/[id]/document/route.ts
// GET -> the contract PDF, for its owner only (an admin may also fetch it for support). The file is read from private storage and
// its SHA-256 is checked against the hash stored when it was issued; a mismatch is refused, never served.
import { NextResponse } from "next/server";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { prisma } from "@/lib/prisma";
import { readContractPdf, sha256Hex } from "@/lib/rewards/documentStorage";

export const dynamic = "force-dynamic";

const json = (code: string, message: string, status: number) => NextResponse.json({ status: "error", error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  const user = await getUserOrNull();
  if (!user) return json("UNAUTHORIZED", "Authentication required", 401);
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const contractId = segments[segments.indexOf("contracts") + 1];
  if (!contractId) return json("VALIDATION", "contract id is required", 400);

  const contract = await prisma.rewardContract.findUnique({ where: { id: contractId }, select: { id: true, userId: true } }).catch(() => null);
  // Same answer for "does not exist" and "not yours", so ids cannot be probed.
  if (!contract || (contract.userId !== user.profile.id && user.profile.role !== "admin")) return json("NOT_FOUND", "Contract not found", 404);
  const doc = await prisma.rewardContractDocument.findUnique({ where: { contractId } });
  if (!doc) return json("NOT_READY", "Your contract document is still being prepared.", 409);

  let bytes: Buffer;
  try {
    bytes = await readContractPdf(doc.storagePath);
  } catch {
    return json("UNAVAILABLE", "The document could not be read right now. Please try again.", 502);
  }
  if (sha256Hex(bytes) !== doc.sha256) return json("INTEGRITY", "The stored document failed its integrity check. Please contact support.", 500);

  await prisma.rewardDownloadLog
    .create({ data: { userId: user.profile.id, contractId, kind: "CONTRACT", ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null } })
    .catch(() => undefined);

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="AT24-contract-${contractId}.pdf"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
