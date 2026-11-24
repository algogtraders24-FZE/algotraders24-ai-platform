// app/dashboard/workspace/page.tsx
// The old Intelligence Workspace page was retired (owner decision 2026-11-24): the Pro Chart is the one place for chart, analysis and trade plans.
// The route stays so old bookmarks and links (Algo Test history, result cards) land on the Pro Chart instead of a 404.
import { redirect } from "next/navigation";

export default function WorkspaceRetiredPage(): never {
  redirect("/dashboard/chart");
}
