// lib/rewards/notices.ts
// (Pure - no I/O.) What a member is told when something happens in their wallet: the bell title and text, the email rows, and where it links.
// One builder per event so the wording is reviewed and tested in one place. Other people are only ever shown masked, never by email address.
// Wording rules: facts only (amount, what, when); never a promise of results; never the words in BANNED_COPY_WORDS.
import { formatUsd } from "./money";

export type NoticeKind =
  | "withdrawal_requested"
  | "withdrawal_paid"
  | "withdrawal_declined"
  | "instalment_released"
  | "instalment_paused"
  | "commission_credited"
  | "contract_cancelled";

export interface Notice {
  kind: NoticeKind;
  severity: "info" | "warning";
  title: string;
  text: string;
  /** Label / value rows for the email. */
  rows: Array<[string, string]>;
  href: string;
  cta: string;
}

const WALLET = "/dashboard/wallet";
const CONTRACTS = "/dashboard/algo-contracts";

export function withdrawalRequested(i: { amountCents: number; network: string; maskedAddress: string }): Notice {
  return {
    kind: "withdrawal_requested", severity: "info", title: "Withdrawal requested",
    text: `We received your request to withdraw ${formatUsd(i.amountCents)} to your ${i.network} address. It is checked and paid by hand.`,
    rows: [["Amount", formatUsd(i.amountCents)], ["Network", i.network], ["To address", i.maskedAddress]],
    href: WALLET, cta: "Open your wallet",
  };
}

export function withdrawalPaid(i: { amountCents: number; network: string; txRef: string }): Notice {
  return {
    kind: "withdrawal_paid", severity: "info", title: "Your withdrawal was paid",
    text: `${formatUsd(i.amountCents)} was sent to your ${i.network} address. Transaction reference: ${i.txRef}.`,
    rows: [["Amount", formatUsd(i.amountCents)], ["Network", i.network], ["Transaction reference", i.txRef]],
    href: WALLET, cta: "Open your wallet",
  };
}

export function withdrawalDeclined(i: { amountCents: number; note?: string | null }): Notice {
  const why = i.note && i.note.trim() ? ` Reason: ${i.note.trim().slice(0, 200)}.` : "";
  return {
    kind: "withdrawal_declined", severity: "warning", title: "Your withdrawal was not paid",
    text: `The withdrawal of ${formatUsd(i.amountCents)} was not paid and the amount is back in your balance.${why}`,
    rows: [["Amount", formatUsd(i.amountCents)], ...(i.note && i.note.trim() ? ([["Reason", i.note.trim().slice(0, 200)]] as Array<[string, string]>) : [])],
    href: WALLET, cta: "Open your wallet",
  };
}

export function instalmentReleased(i: { amountCents: number; contractName: string; seq: number; total: number }): Notice {
  return {
    kind: "instalment_released", severity: "info", title: "Rebate instalment credited",
    text: `Instalment ${i.seq} of ${i.total} of your ${i.contractName} contract, ${formatUsd(i.amountCents)}, is credited to your wallet.`,
    rows: [["Contract", i.contractName], ["Instalment", `${i.seq} of ${i.total}`], ["Amount", formatUsd(i.amountCents)]],
    href: WALLET, cta: "Open your wallet",
  };
}

export function instalmentPaused(i: { amountCents: number; contractName: string; seq: number; total: number }): Notice {
  return {
    kind: "instalment_paused", severity: "warning", title: "A rebate instalment is paused",
    text: `Instalment ${i.seq} of ${i.total} of your ${i.contractName} contract (${formatUsd(i.amountCents)}) is paused because your paid Pro plan or identity check is not in good standing. It is kept for you and credited once both are back.`,
    rows: [["Contract", i.contractName], ["Instalment", `${i.seq} of ${i.total}`], ["Amount", formatUsd(i.amountCents)]],
    href: CONTRACTS, cta: "Open Algo Contracts",
  };
}

export function commissionCredited(i: { amountCents: number; levelLabel: string; sourceText: string; buyerName: string | null }): Notice {
  const from = i.buyerName ? ` from ${i.buyerName}` : "";
  return {
    kind: "commission_credited", severity: "info", title: "Referral commission credited",
    text: `${formatUsd(i.amountCents)} referral commission (${i.levelLabel}) credited${from}: ${i.sourceText}.`,
    rows: [["Amount", formatUsd(i.amountCents)], ["Level", i.levelLabel], ["What was bought", i.sourceText], ...(i.buyerName ? ([["Bought by", i.buyerName]] as Array<[string, string]>) : [])],
    href: WALLET, cta: "Open your wallet",
  };
}

export function contractCancelled(i: { contractName: string; reason?: string | null }): Notice {
  const why = i.reason && i.reason.trim() ? ` Reason: ${i.reason.trim().slice(0, 200)}.` : "";
  return {
    kind: "contract_cancelled", severity: "warning", title: "Your contract was cancelled",
    text: `Your ${i.contractName} contract was cancelled and its remaining rebate instalments will not be credited. Amounts already credited stay in your wallet.${why}`,
    rows: [["Contract", i.contractName], ...(i.reason && i.reason.trim() ? ([["Reason", i.reason.trim().slice(0, 200)]] as Array<[string, string]>) : [])],
    href: CONTRACTS, cta: "Open Algo Contracts",
  };
}
