// lib/rewards/contractPdf.ts
// (Pure - builds bytes, no I/O.) The contract PDF issued to the buyer at purchase. It is a SNAPSHOT of the terms that applied on
// the day: every figure comes from the stored contract, never from today's configuration. Only the brand "algotraders24.ai" is
// named; a legal-entity block is printed only if one is passed in (it is empty by default, see spec section 9).
// DRAFT wording - to be reviewed by counsel before the program opens to the public.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { holdDays, minPayoutCents } from "./config";
import { formatUsd } from "./money";

export interface ContractPdfInput {
  contractId: string;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  buyerUserId: string;
  licenseId: string | null;
  listPriceCents: number;
  rebateTotalCents: number;
  netPriceCents: number;
  schedule: Array<{ seq: number; dueAt: Date; amountCents: number }>;
  startsAt: Date;
  endsAt: Date;
  termsVersion: string;
  consentAt: Date;
  issuedAt: Date;
  /** Optional legal-entity lines (name, licence, address). Empty by default. */
  legalEntityLines?: string[];
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Standard PDF fonts only cover Latin-1; anything else is replaced so a name can never break the document. */
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

export function contractClauses(i: ContractPdfInput): Array<{ title: string; body: string }> {
  const months = Math.round((i.endsAt.getTime() - i.startsAt.getTime()) / (30.44 * 86_400_000));
  return [
    {
      title: "1. Parties",
      body: `This contract is between algotraders24.ai ("AT24") and ${i.buyerName} (${i.buyerEmail}, user ID ${i.buyerUserId}) ("you").`,
    },
    {
      title: "2. What you receive",
      body: `A ${months}-month licence to ${i.productName} for MetaTrader, from ${day(i.startsAt)} to ${day(i.endsAt)}, delivered as a signed licence${i.licenseId ? ` (licence ${i.licenseId})` : ""} with the product files available in your account. The licence ends on the end date above unless renewed.`,
    },
    {
      title: "3. Price",
      body: `Price: ${formatUsd(i.listPriceCents)}. Rebate: ${formatUsd(i.rebateTotalCents)} in total, credited as set out in clause 4. ${i.netPriceCents >= 0 ? `Net price after the rebate: ${formatUsd(i.netPriceCents)}.` : `The total rebate is larger than the price, so once all instalments are credited you have received ${formatUsd(-i.netPriceCents)} more than the price you paid.`}`,
    },
    {
      title: "4. Rebate schedule",
      body:
        i.schedule.map((s) => `Instalment ${s.seq}: ${formatUsd(s.amountCents)}, due ${day(s.dueAt)}`).join("\n") +
        "\nThe rebate accrues monthly over the contract term and is credited every 3 months as listed above; the last instalment carries any remaining months." +
        "\nThe rebate is a fixed adjustment to the price you paid. It is set on the day of purchase and does not depend on trading results, on AT24 revenue, or on any other customer purchase.",
    },
    {
      title: "5. Conditions for crediting and withdrawal",
      body: `An instalment is credited on its due date while you hold an active, paid Pro plan and a verified identity. If either is not in place on the due date, the instalment is paused and kept for you, and is credited once both are restored during the contract term. Credited amounts can be withdrawn in USDT after a ${holdDays()}-day hold, subject to a minimum of ${formatUsd(minPayoutCents())}, and withdrawals also need an active Pro plan and a verified identity at the time of the request. AT24 may withhold or reverse amounts obtained through fraud, self-referral or misuse, and will record the reason.`,
    },
    {
      title: "6. Refunds",
      body: "Sales are final once your licence is issued, except as set out in the AT24 refund policy (duplicate payment, payment taken without a licence being issued, or a product materially different from its description) and except where the law gives you a right that cannot be excluded.",
    },
    {
      title: "7. No promise of results",
      body: "The product is software. AT24 makes no promise about trading results. Trading involves a risk of loss, including the loss of your whole account. The rebate in clause 4 is not a return on any trading activity.",
    },
    {
      title: "8. Records",
      body: `You accepted these terms (version ${i.termsVersion}) and the refund policy on ${i.consentAt.toISOString().replace("T", " ").slice(0, 19)} UTC. This document is a snapshot of the terms that apply to this contract; later changes to the AT24 standard terms do not alter it.`,
    },
  ];
}

export async function buildContractPdf(i: ContractPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`AT24 contract ${i.contractId}`);
  pdf.setAuthor("algotraders24.ai");
  pdf.setCreationDate(i.issuedAt);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 56, maxW = W - 2 * M;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.08, 0.08, 0.1);
  const grey = rgb(0.4, 0.4, 0.45);

  const ensure = (need: number) => {
    if (y - need < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const draw = (text: string, f: PDFFont, size: number, color = ink, gap = 4) => {
    for (const line of wrap(text, f, size, maxW)) {
      ensure(size + gap);
      page.drawText(line, { x: M, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  draw("algotraders24.ai", bold, 20, ink, 6);
  draw("Algo Contract", font, 13, grey, 10);
  for (const l of i.legalEntityLines ?? []) draw(l, font, 9, grey, 2);
  draw(`${i.productName}  -  Contract ${i.contractId}  -  issued ${day(i.issuedAt)}`, font, 10, grey, 16);
  for (const c of contractClauses(i)) {
    y -= 6;
    draw(c.title, bold, 11, ink, 4);
    draw(c.body, font, 10, ink, 3);
  }
  y -= 16;
  draw("Draft wording - subject to legal review. Keep this document for your records.", font, 8, grey, 2);
  return pdf.save();
}
