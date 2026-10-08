// Validates Live Results page rules: viewing access, input validation, slugs.
import assert from "node:assert/strict";
import { canView, newUnlistedKey, slugify, slugWithSuffix, validatePageInput, plainText, DELAY_CHOICES, LISTING_SLUG_RE, MAX_FOLLOWS_PER_USER } from "../services/live-results/pages";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const key = newUnlistedKey();
ok(key.length >= 24 && /^[A-Za-z0-9_-]+$/.test(key), "unlisted key is long and URL-safe");
ok(newUnlistedKey() !== key, "keys are random");

const pub = { visibility: "public", unlistedKey: key };
const unl = { visibility: "unlisted", unlistedKey: key };
const prv = { visibility: "private", unlistedKey: key };
eq([canView(pub, { isOwner: false, key: null }), canView(pub, { isOwner: false, key: "x" })], [true, true], "public: anyone");
eq([canView(unl, { isOwner: false, key: null }), canView(unl, { isOwner: false, key: "wrong" }), canView(unl, { isOwner: false, key })], [false, false, true], "unlisted: only with the right key");
eq(canView(unl, { isOwner: false, key: key + "x" }), false, "unlisted: a longer/different key is refused");
eq([canView(prv, { isOwner: false, key }), canView(prv, { isOwner: false, key: null }), canView(prv, { isOwner: true, key: null })], [false, false, true], "private: owner only (the key does not open a private page)");
eq(canView({ visibility: "weird", unlistedKey: key }, { isOwner: false, key }), false, "unknown visibility fails closed");

eq(slugify("XXXUS30 - Live Forward Test (Demo)"), "xxxus30-live-forward-test-demo", "slugify");
eq(slugify("***"), "results", "slugify falls back");
ok(/^xxxus30-[0-9a-f]{6}$/.test(slugWithSuffix("XXXUS30")), "slug gets a random suffix");
ok(slugWithSuffix("a") !== slugWithSuffix("a"), "suffix makes slugs unique");

const good = { accountId: "cmuy8p807000e04kw7dhqigu3", title: "XXXUS30", description: "five strategies", visibility: "unlisted", magicFilter: "33302", showAmounts: false, positionDelayMin: 15 };
const v = validatePageInput(good);
ok(v.ok && v.value.magicFilter === "33302" && v.value.visibility === "unlisted", "valid input accepted");
eq(validatePageInput({ ...good, magicFilter: "" }).ok && (validatePageInput({ ...good, magicFilter: "" }) as { value: { magicFilter: string | null } }).value.magicFilter, null, "empty magic = whole account");
for (const [bad, why] of [
  [{ ...good, title: "x" }, "short title"],
  [{ ...good, visibility: "everyone" }, "bad visibility"],
  [{ ...good, magicFilter: "12abc" }, "non-numeric magic"],
  [{ ...good, magicFilter: "1".repeat(30) }, "huge magic"],
  [{ ...good, showAmounts: "yes" }, "non-boolean showAmounts"],
  [{ ...good, positionDelayMin: 7 }, "delay not in the list"],
  [{ ...good, accountId: "" }, "missing account"],
  [null, "null body"],
  ["str", "string body"],
] as const) ok(!validatePageInput(bad).ok, `rejects ${why}`);
ok(DELAY_CHOICES.every((d) => validatePageInput({ ...good, positionDelayMin: d }).ok), "every listed delay is accepted");

const t = validatePageInput({ ...good, title: "<script>alert(1)</script> Zeni\u0000th", description: "a\n\n<b>b</b>" });
ok(t.ok && !/[<>\u0000]/.test(t.value.title + t.value.description), "angle brackets and control characters are stripped");
eq(plainText("  a   b \n c  ", 10), "a b c", "whitespace collapsed");
ok(plainText("x".repeat(500), 80).length === 80, "length capped");

// ---- marketplace listing link and follow cap
const withListing = (l: unknown) => validatePageInput({ ...good, listingSlug: l });
const okL = withListing("xxx-us30-multi-module-breakout");
ok(okL.ok && okL.value.listingSlug === "xxx-us30-multi-module-breakout", "a listing slug is accepted");
ok((withListing("") as { ok: true; value: { listingSlug: string | null } }).value.listingSlug === null && (withListing(null) as { ok: true; value: { listingSlug: string | null } }).value.listingSlug === null && (validatePageInput(good) as { ok: true; value: { listingSlug: string | null } }).value.listingSlug === null, "empty / null / missing listing = not attached");
for (const bad of ["Has Space", "UPPER", "-lead", "a".repeat(120), "x/../y", 123, "<b>"]) ok(!withListing(bad).ok, `rejects listing value ${JSON.stringify(bad)}`);
ok(LISTING_SLUG_RE.test("xxxus30-30684e"), "page slugs have the same safe shape (used to validate the follow API input)");
eq(MAX_FOLLOWS_PER_USER, 50, "a member can watch up to 50 pages");

const sb = (x: unknown) => validatePageInput({ ...good, showBroker: x });
eq([sb(true).ok && (sb(true) as { value: { showBroker: boolean } }).value.showBroker, sb(false).ok && (sb(false) as { value: { showBroker: boolean } }).value.showBroker], [true, false], "showBroker true/false is accepted");
eq(validatePageInput(good).ok && (validatePageInput(good) as { value: { showBroker: boolean } }).value.showBroker, false, "showBroker defaults to false (older clients, hidden unless chosen)");
for (const bad of ["yes", 1, null, "true"]) ok(!sb(bad).ok, `rejects showBroker ${JSON.stringify(bad)}`);

console.log(`validate-live-results-pages: ${checks} checks passed`);
