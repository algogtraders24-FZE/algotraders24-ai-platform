"use client";
// app/dashboard/arena/page.tsx - AT24 Arena for signed-in users: the live paper-trading experiment (Claude agents vs rules vs coin flip).
// What users may see is decided on the server (/api/private/arena); this page only renders it.
import ArenaView from "@/components/arena/ArenaView";

export default function ArenaPage() {
  return <ArenaView endpoint="/api/private/arena" variant="user" />;
}
