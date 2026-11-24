// scripts/validate-announcements.ts
// Pure checks for the announcement system (no database, no email): rendering, escaping, CTA allow-list, signed unsubscribe tokens and the
// content policy. Run: npx tsx --conditions=react-server scripts/validate-announcements.ts
process.env.UNSUBSCRIBE_SECRET = "test-secret-for-validation";
import { renderAnnouncementEmail, isAllowedCtaUrl, isAllowedImageUrl, parseBody } from "../services/announcements/render";
import { unsubscribeToken, verifyUnsubscribeToken, validateAnnouncement } from "../services/announcements/service";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
}

const good = {
  subject: "New on the marketplace: Gold Sniper",
  preheader: "An XAUUSD EA with honest evidence",
  bodyText: "Gold Sniper is **now listed**.\n\n- M5 trend + fair value gap\n- One pending order at a time\n\nRead the caveats before deciding.",
  ctaLabel: "View Gold Sniper",
  ctaUrl: "https://www.algotraders24.ai/marketplace/gold-sniper-xauusd-m1-pending-scalper",
};

const { html, text } = renderAnnouncementEmail(good, "https://www.algotraders24.ai/unsubscribe?u=1&t=2");
check("html has the heading, bullets, bold and button", html.includes("<li") && html.includes("<strong>now listed</strong>") && html.includes("View Gold Sniper"));
check("html has the support line, risk line and unsubscribe link", html.includes("support@algotraders24.ai") && html.includes("risky") && html.includes("Unsubscribe from product updates"));
check("plain text has no HTML and keeps the link + unsubscribe", !/<[a-z]/i.test(text) && text.includes("Unsubscribe from product updates:") && text.includes("marketplace/gold-sniper"));

const evil = renderAnnouncementEmail({ ...good, subject: '<script>alert(1)</script> hello there', bodyText: 'Hi <img src=x onerror=alert(1)> **bold**\n\nsecond paragraph with enough text to pass' }, "https://x");
check("markup typed in the box is escaped", !evil.html.includes("<script>alert") && !evil.html.includes("<img src=x") && evil.html.includes("&lt;script&gt;"));

check("CTA allow-list: platform https ok", isAllowedCtaUrl("https://www.algotraders24.ai/x") && isAllowedCtaUrl("https://algotraders24.ai"));
check("CTA allow-list: other domain / http / junk refused", !isAllowedCtaUrl("https://evil.com/algotraders24.ai") && !isAllowedCtaUrl("http://algotraders24.ai") && !isAllowedCtaUrl("javascript:alert(1)") && !isAllowedCtaUrl("https://algotraders24.ai.evil.com"));
const badCta = renderAnnouncementEmail({ ...good, ctaUrl: "https://evil.com" }, "https://x");
check("a disallowed CTA link is never rendered", !badCta.html.includes("evil.com"));

check("parseBody: paragraphs and bullets", JSON.stringify(parseBody("a\n\n- b\n- c").map((b) => b.kind)) === JSON.stringify(["p", "ul"]));

// creative email: own-domain image + highlighted callout
const IMG = "https://www.algotraders24.ai/marketing/ugea/ugea-email-hero.png";
const creative = renderAnnouncementEmail({ ...good, bodyText: `![Universal Gold EA](${IMG})

> **Launch price:** 399 USD for the first 10 buyers.

Some words here that make the body long enough.` }, "https://x");
check("image block renders an img tag with the alt text", creative.html.includes(`<img src="${IMG}"`) && creative.html.includes('alt="Universal Gold EA"'));
check("callout block renders highlighted with bold", creative.html.includes("#fbf4de") && creative.html.includes("<strong>Launch price:</strong>"));
check("plain text drops the image and keeps the callout words", !creative.text.includes("<img") && !creative.text.includes("ugea-email-hero") && creative.text.includes("Launch price: 399 USD"));
check("image allow-list: own domain /marketing and /marketplace png/jpg/webp ok", isAllowedImageUrl(IMG) && isAllowedImageUrl("https://algotraders24.ai/marketplace/x/banner.jpg"));
check("image allow-list: other host, http, query, wrong folder, wrong type, traversal refused", !isAllowedImageUrl("https://evil.com/marketing/a.png") && !isAllowedImageUrl("http://www.algotraders24.ai/marketing/a.png") && !isAllowedImageUrl(IMG + "?x=1") && !isAllowedImageUrl("https://www.algotraders24.ai/api/secret.png") && !isAllowedImageUrl("https://www.algotraders24.ai/marketing/a.svg") && !isAllowedImageUrl("https://www.algotraders24.ai/marketing/../api/a.png") && !isAllowedImageUrl("https://algotraders24.ai.evil.com/marketing/a.png"));
const badImg = renderAnnouncementEmail({ ...good, bodyText: "![x](https://evil.com/marketing/a.png)\n\nBody text long enough to pass the length rule here." }, "https://x");
check("a disallowed image is never rendered as an img", !badImg.html.includes("<img") && !badImg.html.includes('src="https://evil.com'));
check("alt text is escaped", !renderAnnouncementEmail({ ...good, bodyText: `![a"><script>x</script>](${IMG})

Body long enough to pass the length rule here.` }, "https://x").html.includes("<script>x"));

const tok = unsubscribeToken("user_1");
check("unsubscribe token verifies for its own user", verifyUnsubscribeToken("user_1", tok));
check("unsubscribe token fails for another user / tampered / empty", !verifyUnsubscribeToken("user_2", tok) && !verifyUnsubscribeToken("user_1", tok.slice(0, -2) + "xx") && !verifyUnsubscribeToken("user_1", ""));

check("validate: a good announcement passes", validateAnnouncement(good) === null);
check("validate: short subject / short body refused", validateAnnouncement({ ...good, subject: "Hi" }) !== null && validateAnnouncement({ ...good, bodyText: "too short" }) !== null);
check("validate: label without link refused", validateAnnouncement({ ...good, ctaUrl: "" }) !== null);
check("validate: off-platform link refused", validateAnnouncement({ ...good, ctaUrl: "https://evil.com/x" }) !== null);
check("validate: guarantees / calls refused", validateAnnouncement({ ...good, bodyText: good.bodyText + "\n\nThis is guaranteed profit, buy now." }) !== null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
