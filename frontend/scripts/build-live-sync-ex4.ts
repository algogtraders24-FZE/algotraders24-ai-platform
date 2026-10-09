// scripts/build-live-sync-ex4.ts
// Builds the downloadable compiled MetaTrader 4 EA (public/downloads/AT24LiveSync-MT4.ex4) from the public source with the REAL
// MT4 MetaEditor, and writes a manifest that ties the two together (source hash -> compiled hash), so a stale or swapped
// binary is caught by `validate-live-sync-ea-mt4`. Windows + a MetaTrader 4 terminal only.
// Run after every change to AT24LiveSync-MT4.mq4:  npx tsx scripts/build-live-sync-ex4.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DL = resolve(__dirname, "..", "public", "downloads");
const SRC = join(DL, "AT24LiveSync-MT4.mq4");
const OUT = join(DL, "AT24LiveSync-MT4.ex4");
const MANIFEST = join(DL, "AT24LiveSync-MT4.manifest.json");
const editor = process.env.METAEDITOR4_PATH ?? "C:\\Program Files (x86)\\Vantage Markets MT4 Terminal\\metaeditor.exe";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** The source is hashed with LF line endings so the value is the same on every checkout (Windows may convert). */
const shaText = (b: Buffer) => sha(Buffer.from(b.toString("utf8").split("\r\n").join("\n")));
assert.ok(process.platform === "win32" && existsSync(editor), "MT4 metaeditor.exe not found (set METAEDITOR4_PATH)");

const dir = mkdtempSync(join(tmpdir(), "at24ea4-build-"));
const target = join(dir, "AT24LiveSync-MT4.mq4");
copyFileSync(SRC, target);
const log = join(dir, "compile.log");
writeFileSync(log, "");
spawnSync(editor, [`/compile:${target}`, `/log:${log}`], { timeout: 120_000 });
const raw = readFileSync(log);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8");
const m = /Result:\s*(\d+) errors?,\s*(\d+) warnings?/.exec(text);
assert.ok(m, `no compile result in log:\n${text.slice(-400)}`);
assert.equal(Number(m[1]), 0, `compile errors:\n${text}`);
assert.equal(Number(m[2]), 0, `compile warnings:\n${text}`);
const built = join(dir, "AT24LiveSync-MT4.ex4");
assert.ok(existsSync(built), "compiled .ex4 not produced");

copyFileSync(built, OUT);
const src = readFileSync(SRC);
const ex4 = readFileSync(OUT);
const version = /#property\s+version\s+"([^"]+)"/.exec(src.toString("utf8"))?.[1] ?? "unknown";
writeFileSync(
  MANIFEST,
  JSON.stringify({ name: "AT24LiveSync-MT4", version, source: "AT24LiveSync-MT4.mq4", sourceSha256: shaText(src), ex4: "AT24LiveSync-MT4.ex4", ex4Sha256: sha(ex4), ex4Bytes: statSync(OUT).size }, null, 2) + "\n",
);
console.log(`built ${OUT} (${ex4.length} bytes), version ${version}`);
