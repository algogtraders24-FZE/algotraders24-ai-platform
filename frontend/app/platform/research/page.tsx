// app/platform/research/page.tsx
// Sprint D2.4.A1 - "Research" is not a distinct product surface: the AI
// Assistant already handles research/knowledge-grounded questions (confirmed
// in the D2.3.S4 audit), so a separate "Research" marketing page would be a
// thin duplicate of /platform/assistant rather than real, distinct content.
// Redirects instead of shipping a near-empty page, per the approved
// D2.4.A1 IA plan.
import { redirect } from "next/navigation";

export default function ResearchPlatformPage() {
  redirect("/platform/assistant");
}
