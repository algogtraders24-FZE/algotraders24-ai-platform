// components/quant-lite/TradeTable.tsx
// Sprint Q0.8 - displays only fields the engine actually returns per
// trade (Q0.7_PRODUCT_PIPELINE.md Part 6). SL/TP price levels are NOT
// currently stored per-trade by the engine - shown as "Not available",
// never fabricated from the exit reason.
import Badge from "@/components/ui/Badge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import { FIN_PRIMARY, financialDirectionClass } from "@/components/ui/financial-typography";
import type { Trade } from "@/types/quant-lite";

export default function TradeTable({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return <p className="text-sm text-text-3">Not available - no trades in this backtest.</p>;
  }

  return (
    <>
      <Table>
        <Thead>
          <Tr>
            <Th>#</Th>
            <Th>Direction</Th>
            <Th>Entry Time</Th>
            <Th>Entry Price</Th>
            <Th>Exit Time</Th>
            <Th>Exit Price</Th>
            <Th>SL</Th>
            <Th>TP</Th>
            <Th>Exit Reason</Th>
            <Th>PnL</Th>
          </Tr>
        </Thead>
        <Tbody>
          {trades.map((t) => (
            <Tr key={t.tradeNumber}>
              <Td>{t.tradeNumber}</Td>
              <Td>
                <Badge tone={t.direction === "BUY" ? "success" : "danger"}>{t.direction}</Badge>
              </Td>
              <Td className="whitespace-nowrap">{new Date(t.entryTime).toLocaleString()}</Td>
              <Td className={FIN_PRIMARY}>{t.entryPrice.toFixed(3)}</Td>
              <Td className="whitespace-nowrap">{new Date(t.exitTime).toLocaleString()}</Td>
              <Td className={FIN_PRIMARY}>{t.exitPrice.toFixed(3)}</Td>
              <Td className="text-text-3">{t.slPrice != null ? t.slPrice.toFixed(3) : "Not available"}</Td>
              <Td className="text-text-3">{t.tpPrice != null ? t.tpPrice.toFixed(3) : "Not available"}</Td>
              <Td>
                <Badge tone={t.exitReason === "TP" ? "success" : t.exitReason === "SL" ? "danger" : "neutral"}>{t.exitReason}</Badge>
              </Td>
              <Td className={[FIN_PRIMARY, financialDirectionClass(t.pnl > 0 ? "up" : t.pnl < 0 ? "down" : "neutral")].join(" ")}>
                {t.pnl >= 0 ? "+" : ""}
                {t.pnl.toFixed(2)}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </>
  );
}
