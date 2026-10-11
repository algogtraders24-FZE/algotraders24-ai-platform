// Validates which media URLs the share card may fetch (own site / own storage only). Pure.
import assert from "node:assert/strict";
import { logoFetchUrl } from "../lib/marketplace/shareLogo";

let checks = 0;
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const SITE = "https://algotraders24.ai";
const SB = "https://abc.supabase.co";

eq(logoFetchUrl("/marketplace/x/icon.png", SITE, SB), "https://algotraders24.ai/marketplace/x/icon.png", "relative path = own site");
eq(logoFetchUrl("https://abc.supabase.co/storage/v1/object/public/marketplace-media/a.png", SITE, SB), "https://abc.supabase.co/storage/v1/object/public/marketplace-media/a.png", "own storage host");
eq(logoFetchUrl("https://algotraders24.ai/a.png", SITE, SB), "https://algotraders24.ai/a.png", "own site absolute");
eq(logoFetchUrl("https://evil.example/a.png", SITE, SB), null, "foreign host refused");
eq(logoFetchUrl("//evil.example/a.png", SITE, SB), null, "protocol-relative refused");
eq(logoFetchUrl("http://abc.supabase.co/a.png", SITE, SB), null, "plain http refused");
eq(logoFetchUrl("http://169.254.169.254/latest", SITE, SB), null, "metadata address refused");
eq(logoFetchUrl("https://abc.supabase.co.evil.example/a.png", SITE, SB), null, "look-alike host refused");
eq(logoFetchUrl(undefined, SITE, SB), null, "no media");
eq(logoFetchUrl("not a url", SITE, undefined), null, "garbage refused");
eq(logoFetchUrl("https://abc.supabase.co/a.png", SITE, undefined), null, "storage host unknown = refused");

console.log(`validate-share-logo: ${checks} checks passed`);
