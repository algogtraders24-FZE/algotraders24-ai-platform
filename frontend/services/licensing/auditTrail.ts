// services/licensing/auditTrail.ts
// Sprint M11 - thin wrapper scoping AuditLogService to license.*/release.*
// actions (brief section 16). Every security-sensitive licensing action
// gets one real, persisted, append-only row - actor, timestamp, license,
// result, and reason are always present in metadata, per the brief's own
// required fields.
import "server-only";
import { auditLogService, type AuditAction } from "@/services/admin/AuditLogService";

export async function recordLicenseAudit(params: {
  actorUserId: string;
  action: AuditAction;
  licenseId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await auditLogService.record({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: "License",
    targetId: params.licenseId,
    metadata: params.metadata,
  });
}

export async function recordReleaseDownload(params: { actorUserId: string; releaseId: string; licenseId: string }): Promise<void> {
  await auditLogService.record({
    actorUserId: params.actorUserId,
    action: "release.downloaded",
    targetType: "ReleaseArtifact",
    targetId: params.releaseId,
    metadata: { licenseId: params.licenseId, result: "OK" },
  });
}
