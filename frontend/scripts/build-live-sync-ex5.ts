// scripts/build-live-sync-ex5.ts
// Builds the downloadable compiled EA (public/downloads/AT24LiveSync.ex5) from the public source with the REAL
// MetaEditor, and writes a manifest that ties the two together (source hash -> compiled hash), so a stale or
// swapped binary is caught by `validate-live-sync-ea`. Windows + MetaTrader 5 only.
// Run after every change to AT24LiveSync.mq5:  npx tsx scripts/build-live-sync-ex5.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DL = resolve(__dirname, "..", "public", "downloads");
const SRC = join(DL, "AT24LiveSync.mq5");
const OUT = join(DL, "AT24LiveSync.ex5");
const MANIFEST = join(DL, "AT24LiveSync.manifest.json");
const editor = process.env.METAEDITOR_PATH ?? "C:\\Program Files\\MetaTrader 5\\MetaEditor64.exe";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** The source is hashed with LF line endings so the value is the same on every checkout (Windows may convert). */
const shaText = (b: Buffer) => sha(Buffer.from(b.toString("utf8").split("\r\n").join("\n")));
assert.ok(process.platform === "win32" && existsSync(editor), "MetaEditor64.exe not found (set METAEDITOR_PATH)");

const dir = mkdtempSync(join(tmpdir(), "at24ea-build-"));
const target = join(dir, "AT24LiveSync.mq5");
copyFileSync(SRC, target);
const log = join(dir, "compile.log");
writeFileSync(log, "");
spawnSync(editor, [`/compile:${target}`, `/log:${log}`], { timeout: 120_000 });
const text = readFileSync(log).toString("utf16le");
const m = /Result:\s*(\d+) errors?,\s*(\d+) warnings?/.exec(text);
assert.ok(m, `no compile result in log:\n${text.slice(-400)}`);
assert.equal(Number(m[1]), 0, `compile errors:\n${text}`);
assert.equal(Number(m[2]), 0, `compile warnings:\n${text}`);
const built = join(dir, "AT24LiveSync.ex5");
assert.ok(existsSync(built), "compiled .ex5 not produced");

copyFileSync(built, OUT);
const src = readFileSync(SRC);
const ex5 = readFileSync(OUT);
const version = /#property\s+version\s+"([^"]+)"/.exec(src.toString("utf8"))?.[1] ?? "unknown";
const build = /build\s+(\d{3,5})/i.exec(text)?.[1] ?? null;
writeFileSync(
  MANIFEST,
  JSON.stringify({ name: "AT24LiveSync", version, source: "AT24LiveSync.mq5", sourceSha256: shaText(src), ex5: "AT24LiveSync.ex5", ex5Sha256: sha(ex5), ex5Bytes: statSync(OUT).size, metaEditorBuild: build }, null, 2) + "\n",
);
console.log(`built ${OUT} (${ex5.length} bytes), version ${version}, metaeditor build ${build ?? "?"}`);
