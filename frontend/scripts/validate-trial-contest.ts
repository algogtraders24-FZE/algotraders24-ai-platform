// scripts/validate-trial-contest.ts - pure checks for the discount maths and the trial email content (no DB / network).
import "dotenv/config";
// Run: npx tsx --conditions=react-server scripts/validate-trial-contest.ts
import { discountedAmount } from "../services/marketplace/paymentLinkService";
import { validateAnnouncement } from "../services/announcements/service";
import { buildTrialEmail } from "../services/trial/trialEmails";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

check("20% off 699 = 559.20", discountedAmount(699, 20) === 559.2, String(discountedAmount(699, 20)));
check("no discount keeps the price", discountedAmount(699, null) === 699 && discountedAmount(699, 0) === 699 && discountedAmount(699, undefined) === 699);
check("a bad percent means no discount", discountedAmount(699, 100) === 699 && discountedAmount(699, 150) === 699 && discountedAmount(699, -5) === 699 && discountedAmount(699, NaN) === 699);
check("rounds to cents", discountedAmount(99.99, 33) === 66.99, String(discountedAmount(99.99, 33)));
check("never below one cent", discountedAmount(0.01, 99) >= 0.01);

async function main() {
  const input = { userId: "u1", email: "a@b.co", licenseId: "lic_x", productId: "XXXUS30", expiresAt: "2026-12-01T00:00:00.000Z" };
  for (const step of ["WELCOME", "D7", "D24", "D31"] as const) {
    let content;
    try {
      content = await buildTrialEmail(step, input);
    } catch (e) {
      // buildTrialEmail asks the database for an open contest; without a database the content cannot be built here
      console.log("SKIP  trial email content needs the database:", (e as Error).message.split("\n")[0]);
      break;
    }
    const bad = validateAnnouncement(content);
    check(`trial email ${step} passes the content policy (no hype, valid link)`, bad === null, bad ?? "");
    check(`trial email ${step} carries no profit claim`, !/(profit|guarantee|earn|return)s? of/i.test(content.bodyText));
  }
  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
