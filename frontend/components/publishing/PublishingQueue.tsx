// components/publishing/PublishingQueue.tsx
// Sprint UI-03 - hand-rolled table shell -> the shared Table primitive
// (same header/row/border contract every other dashboard table uses).
import type { Article } from "@/types/article";
import PublishingStatus from "./PublishingStatus";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";

export default function PublishingQueue({ articles }: { articles: Article[] }) {
  const queued = articles.filter((a) => a.status === "scheduled" || a.status === "draft");
  return (
    <Table>
      <Thead>
        <tr>
          <Th>Article</Th>
          <Th>Category</Th>
          <Th>Scheduled</Th>
          <Th>Status</Th>
        </tr>
      </Thead>
      <Tbody>
        {queued.map((a) => (
          <Tr key={a.id}>
            <Td className="font-medium text-text">{a.title}</Td>
            <Td className="capitalize">{a.category.replace(/-/g, " ")}</Td>
            <Td>{a.scheduledFor ? new Date(a.scheduledFor).toLocaleString() : "—"}</Td>
            <Td><PublishingStatus status={a.status} /></Td>
          </Tr>
        ))}
        {queued.length === 0 && (
          <Tr><Td colSpan={4} className="py-6 text-center text-xs text-text-3">Queue is empty.</Td></Tr>
        )}
      </Tbody>
    </Table>
  );
}