// components/help/GuideSection.tsx
// A titled card used by the in-app how-to guides (/dashboard/help/*). Plain
// presentational wrapper so every guide reads the same.
import type { ReactNode } from "react";
import Card from "@/components/ui/Card";

export default function GuideSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3" id={id}>
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <div className="space-y-3 text-sm leading-6 text-text-2">{children}</div>
    </Card>
  );
}

/** Small monospace block for commands/config the reader copies. */
export function CodeBlock({ children }: { children: ReactNode }) {
  return <pre className="overflow-x-auto rounded-control border border-border bg-ink-2 p-3 text-xs text-text">{children}</pre>;
}
