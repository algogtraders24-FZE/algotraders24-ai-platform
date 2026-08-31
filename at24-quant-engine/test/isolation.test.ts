import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const srcDir = join(here, "..", "src");

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']@\//, // frontend's "@/*" path alias
  /from\s+["'].*\/frontend\//,
  /from\s+["'].*\/ea-research\//,
  /prisma/i,
  /@prisma\/client/,
];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

test("no source file imports from the frontend app, ea-research, or Prisma", () => {
  const files = collectTsFiles(srcDir);
  assert.ok(files.length > 0, "expected to find source files to scan");

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      assert.doesNotMatch(content, pattern, `${file} must not reference M-Series/Prisma (matched ${pattern})`);
    }
  }
});

test("the package has zero runtime dependencies on M-Series or database drivers", () => {
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
  assert.deepEqual(pkg.dependencies ?? {}, {}, "quant engine must declare no runtime dependencies");
});

test("the package is a standalone workspace, not part of the frontend app or a monorepo root", () => {
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
  assert.equal(pkg.name, "@at24/quant-engine");
  const rootEntries = readdirSync(repoRoot);
  assert.ok(!rootEntries.includes("pnpm-workspace.yaml"));
});
