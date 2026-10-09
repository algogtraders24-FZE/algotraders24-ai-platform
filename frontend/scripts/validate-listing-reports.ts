// scripts/validate-listing-reports.ts
// Seller self-serve Phase 5: report validation + the auto-suspend rule (pure). Run: npx tsx scripts/validate-listing-reports.ts
import { REPORT_REASONS, SUSPEND_THRESHOLD, isReportReason, shouldAutoSuspend, validateReport } from "../lib/marketplace/reports";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

check("three distinct buyers is the threshold", SUSPEND_THRESHOLD === 3);
check("below the threshold nothing is suspended", !shouldAutoSuspend({ distinctOpenReporters: 2, publicationState: "PUBLISHED", sellerIsPlatformOwner: false }));
check("the third distinct report suspends a published listing", shouldAutoSuspend({ distinctOpenReporters: 3, publicationState: "PUBLISHED", sellerIsPlatformOwner: false }));
check("more than the threshold still suspends", shouldAutoSuspend({ distinctOpenReporters: 9, publicationState: "READY", sellerIsPlatformOwner: false }));
check("the platform owner's own listings are never auto-suspended", !shouldAutoSuspend({ distinctOpenReporters: 50, publicationState: "PUBLISHED", sellerIsPlatformOwner: true }));
check("an already suspended / retired / draft listing is left alone", ["SUSPENDED", "RETIRED", "DRAFT"].every((s) => !shouldAutoSuspend({ distinctOpenReporters: 5, publicationState: s, sellerIsPlatformOwner: false })));

check("every listed reason is accepted, unknown ones are not", REPORT_REASONS.every((r) => isReportReason(r.key)) && !isReportReason("SPAM") && !isReportReason(undefined) && !isReportReason(3));
check("a good report passes", validateReport({ reason: "MALWARE", details: "It opened a command window and tried to download a file." }) === null);
check("no reason / bad reason is refused", validateReport({ reason: "", details: "long enough details here" }) !== null && validateReport({ reason: "NOPE", details: "long enough details here" }) !== null);
check("too-short details are refused", validateReport({ reason: "OTHER", details: "bad" }) !== null && validateReport({ reason: "OTHER", details: "         " }) !== null);
check("too-long details are refused", validateReport({ reason: "OTHER", details: "x".repeat(1001) }) !== null && validateReport({ reason: "OTHER", details: "x".repeat(1000) }) === null);
check("non-string details are refused", validateReport({ reason: "OTHER", details: { a: 1 } }) !== null && validateReport({ reason: "OTHER", details: null }) !== null);

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
