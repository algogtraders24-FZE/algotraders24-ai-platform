"use client";
// app/dashboard/admin/arena/page.tsx - admin view of the AT24 Arena (full detail, incl. Claude spend). The page body lives in components/arena/ArenaView.tsx.
import ArenaView from "@/components/arena/ArenaView";

export default function AdminArenaPage() {
  return <ArenaView endpoint="/api/private/admin/arena" variant="admin" />;
}
