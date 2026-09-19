// services/support/handoff-route-path.ts
// AT24 Support Human Handoff MVP - shared path-segment extraction for every
// [id]-shaped handoff route, matching the exact convention this codebase's
// other private routes already use (e.g. runs/[id]/resolution/route.ts's
// own runIdFromPath helper) - withContext does not pass a `params` object,
// the id is read from ctx.path instead.

function idAfterSegment(path: string, segment: string): string | undefined {
  const segments = path.split("/").filter(Boolean);
  const idx = segments.indexOf(segment);
  return idx >= 0 ? segments[idx + 1] : undefined;
}

/** For /api/private/support/handoff/[id](/...) */
export function handoffIdFromPath(path: string): string | undefined {
  return idAfterSegment(path, "handoff");
}

/** For /api/private/admin/support-handoffs/[id](/...) */
export function adminHandoffIdFromPath(path: string): string | undefined {
  return idAfterSegment(path, "support-handoffs");
}
