// scripts/cleanup-unverified-auth-users.mjs
// Removes bot signups from Supabase Auth: users who NEVER verified their email, NEVER signed in, and are older than N days (default 3).
// DRY RUN BY DEFAULT: it only lists what it would delete. Nothing is deleted unless you pass --apply.
//
//   cd frontend
//   node --env-file=.env scripts/cleanup-unverified-auth-users.mjs                 (dry run: counts + a sample)
//   node --env-file=.env scripts/cleanup-unverified-auth-users.mjs --apply         (deletes exactly what the dry run showed)
//   node --env-file=.env scripts/cleanup-unverified-auth-users.mjs --days 7        (older than 7 days instead of 3)
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in frontend/.env (already there for the app). The key is only read from
// the environment; it is never printed. Verified users, anyone who has ever signed in, and signups newer than N days are never touched.
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const daysIdx = process.argv.indexOf("--days");
const days = daysIdx > -1 ? Number(process.argv[daysIdx + 1]) : 3;
if (!Number.isFinite(days) || days < 1) {
  console.error("--days must be a number of at least 1");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env scripts/cleanup-unverified-auth-users.mjs");
  process.exit(2);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const cutoff = Date.now() - days * 86_400_000;

const all = [];
for (let page = 1; page < 200; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error("Could not list users:", error.message);
    process.exit(1);
  }
  all.push(...data.users);
  if (data.users.length < 1000) break;
}

const targets = all.filter((u) => !u.email_confirmed_at && !u.confirmed_at && !u.last_sign_in_at && new Date(u.created_at).getTime() < cutoff);
const nameOf = (u) => String(u.user_metadata?.name ?? u.user_metadata?.full_name ?? "");
const withClaim = targets.filter((u) => /claim/i.test(nameOf(u))).length;

console.log(`Total users in Supabase Auth : ${all.length}`);
console.log(`Never verified, never signed in, older than ${days} days : ${targets.length}`);
console.log(`...of those, with "claim" in the name : ${withClaim}`);
console.log("\nSample (newest 15 of the ones that would be deleted):");
for (const u of [...targets].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15)) {
  console.log(`  ${u.created_at.slice(0, 10)}  ${(u.email ?? "").padEnd(36)} ${nameOf(u).slice(0, 40)}`);
}

if (!apply) {
  console.log("\nDRY RUN - nothing was deleted. Check the sample above. If every row is spam, run again with --apply.");
  process.exit(0);
}

console.log(`\nDeleting ${targets.length} users...`);
let ok = 0;
let failed = 0;
for (const u of targets) {
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) {
    failed++;
    console.error(`  failed ${u.id}: ${error.message}`);
  } else {
    ok++;
  }
}
console.log(`Done. Deleted ${ok}, failed ${failed}. Users left: ${all.length - ok}.`);
