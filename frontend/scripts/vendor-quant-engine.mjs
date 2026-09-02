#!/usr/bin/env node
// scripts/vendor-quant-engine.mjs
// P3.2A.1 Gate 1 - copies at24-quant-engine's BUILT dist/ output (never its
// hand-written src/) into frontend/vendor/at24-quant-engine/, which is
// INSIDE this Next.js app's own directory tree - unlike the previous
// `file:../at24-quant-engine` dependency (proven, this sprint, to break a
// real `next build` whenever the sibling at24-quant-engine/ directory
// isn't present - exactly Vercel's typical monorepo Root-Directory=frontend
// build context), this vendored copy requires nothing outside `frontend/`
// itself, so it builds identically in local dev, CI, and on Vercel with no
// dashboard configuration required.
//
// Run this whenever at24-quant-engine/src/ changes:
//   node scripts/vendor-quant-engine.mjs
// then commit the updated frontend/vendor/at24-quant-engine/ directory.
// See docs/P3.2A.1-DEPLOYMENT-GATE.md for the full rationale and the
// npm-workspace alternative this can be replaced by once Vercel's Root
// Directory / "include outside root" setting is confirmed.
import { execSync } from "node:child_process";
import { existsSync, cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_ROOT = path.resolve(FRONTEND_ROOT, "..", "at24-quant-engine");
const VENDOR_DIR = path.join(FRONTEND_ROOT, "vendor", "at24-quant-engine");

if (!existsSync(ENGINE_ROOT)) {
  console.error(`vendor-quant-engine: at24-quant-engine not found at ${ENGINE_ROOT} - this script must be run from a full monorepo checkout (it produces the vendored copy that DOESN'T need that checkout afterwards).`);
  process.exit(1);
}

console.log(`vendor-quant-engine: building ${ENGINE_ROOT} ...`);
execSync("npm run build", { cwd: ENGINE_ROOT, stdio: "inherit" });

const enginePkg = JSON.parse(readFileSync(path.join(ENGINE_ROOT, "package.json"), "utf8"));
const engineDist = path.join(ENGINE_ROOT, "dist");
if (!existsSync(engineDist)) {
  console.error(`vendor-quant-engine: build did not produce ${engineDist}`);
  process.exit(1);
}

rmSync(VENDOR_DIR, { recursive: true, force: true });
mkdirSync(VENDOR_DIR, { recursive: true });
cpSync(engineDist, path.join(VENDOR_DIR, "dist"), { recursive: true });

// A trimmed package.json - only what a consumer needs to resolve the
// package, never the devDependencies/scripts that built it.
const vendoredPkg = {
  name: "at24-quant-engine",
  version: enginePkg.version,
  private: true,
  type: enginePkg.type,
  main: enginePkg.main,
  types: enginePkg.types,
  exports: enginePkg.exports,
  description: `Vendored build of @at24/quant-engine ${enginePkg.version} - see scripts/vendor-quant-engine.mjs. Do not hand-edit; regenerate instead.`,
};
writeFileSync(path.join(VENDOR_DIR, "package.json"), JSON.stringify(vendoredPkg, null, 2) + "\n");

console.log(`vendor-quant-engine: wrote ${VENDOR_DIR} (${enginePkg.version})`);
