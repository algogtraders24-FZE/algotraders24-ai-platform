// scripts/check-rewards-migration.cjs
// READ-ONLY. Tells you whether the Algo Contracts tables exist in the database DIRECT_URL points at. It changes nothing.
// Run from frontend/ (so `pg` resolves), with DIRECT_URL set in your shell or loaded from .env:
//   node -r dotenv/config scripts/check-rewards-migration.cjs
const { Client } = require("pg");

const NEW = [
  "reward_products", "reward_slot_months", "reward_slot_holds", "reward_contracts", "reward_contract_documents",
  "rebate_installments", "referral_codes", "referral_attributions", "referral_commissions", "reward_ledger_entries",
  "reward_reserve_entries", "reward_payouts", "reward_download_logs", "reward_audit_events", "reward_checkouts",
];
const READS = ["Subscription", "User", "seller_identities", "purchases", "marketplace_purchase_intents", "licenses"];

(async () => {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL is not set");
  const c = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  await c.connect();
  const present = async (names) =>
    new Set((await c.query("select table_name from information_schema.tables where table_schema='public' and table_name = any($1)", [names])).rows.map((r) => r.table_name));
  const have = await present(NEW);
  const base = await present(READS);
  console.log(`Algo Contracts tables present: ${have.size}/${NEW.length}`);
  for (const t of NEW) console.log(`  ${have.has(t) ? "OK     " : "MISSING"} ${t}`);
  console.log(`Existing tables the program reads: ${base.size}/${READS.length}${base.size === READS.length ? " (all there)" : " (SOME MISSING: " + READS.filter((t) => !base.has(t)).join(", ") + ")"}`);
  console.log(have.size === NEW.length ? "\nMigration is applied." : have.size === 0 ? "\nMigration NOT applied yet." : "\nPartly applied: run the migration again (it is safe to repeat).");
  await c.end();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
