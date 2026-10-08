// scripts/validate-seller-self-serve.ts
// Offline checks (no DB, no network) for the seller self-serve policy + file hygiene:
//   npx tsx scripts/validate-seller-self-serve.ts
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  parseMode, parseAllowlist, selfServeAllowedFor, isPlatformOwner, extensionOf, sanitizeFileName,
  checkPublishRequirements, MAX_BUILD_BYTES, MIN_DESCRIPTION_CHARS,
} from "../lib/marketplace/selfServe";
import { inspectBuild, listZipEntries } from "../lib/marketplace/buildInspect";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass += 1;
  console.log(`  ok   - ${name}`);
}

// ---- tiny zip builder (stored/deflated, central directory only matters for the reader under test)
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function makeZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const comp = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(f.data.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

console.log("Seller self-serve validation");

ok("mode parsing defaults to off and accepts only the three values", () => {
  assert.equal(parseMode(undefined), "off");
  assert.equal(parseMode(""), "off");
  assert.equal(parseMode("PUBLIC"), "public");
  assert.equal(parseMode(" allowlist "), "allowlist");
  assert.equal(parseMode("yes"), "off");
});
ok("allowlist parsing trims, lowercases and drops blanks", () => {
  assert.deepEqual(parseAllowlist(" A@x.com, ,b@Y.com "), ["a@x.com", "b@y.com"]);
});
ok("owner accounts are always allowed, even with the mode off", () => {
  assert.equal(isPlatformOwner("Algogtraders24@gmail.com"), true);
  assert.equal(selfServeAllowedFor("algogtraders24@gmail.com", "off", []), true);
  assert.equal(selfServeAllowedFor("pravinawari@outlook.com", "off", []), true);
});
ok("a normal user is blocked when off, only listed users pass in allowlist mode, everyone logged in passes in public mode", () => {
  assert.equal(selfServeAllowedFor("u@x.com", "off", ["u@x.com"]), false);
  assert.equal(selfServeAllowedFor("u@x.com", "allowlist", ["u@x.com"]), true);
  assert.equal(selfServeAllowedFor("v@x.com", "allowlist", ["u@x.com"]), false);
  assert.equal(selfServeAllowedFor("v@x.com", "public", []), true);
  assert.equal(selfServeAllowedFor(null, "public", []), false);
});
ok("file names: extension + sanitising", () => {
  assert.equal(extensionOf("My EA.EX5"), ".ex5");
  assert.equal(extensionOf("noext"), "");
  const sane = sanitizeFileName("../../evil name?.ex5");
  assert.ok(!sane.includes("..") && !sane.includes("/") && !sane.includes("\\") && sane.endsWith(".ex5") && !sane.startsWith("."), sane);
  assert.equal(sanitizeFileName("???"), "product");
});

ok("a normal .ex5 passes and gets a SHA-256", () => {
  const r = inspectBuild("MyEA.ex5", Buffer.from("not really an ex5 but harmless bytes"));
  assert.equal(r.ok, true);
  assert.equal(r.sha256.length, 64);
});
ok("windows executables are rejected by extension and by MZ header", () => {
  assert.equal(inspectBuild("setup.exe", Buffer.from("MZxx")).ok, false);
  const renamed = inspectBuild("MyEA.ex5", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(40)]));
  assert.equal(renamed.ok, false);
  assert.match(renamed.reasons.join(" "), /Windows executable/);
});
ok("ELF binaries and shebang scripts are rejected", () => {
  assert.equal(inspectBuild("a.ex5", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2])).ok, false);
  assert.equal(inspectBuild("a.ex5", Buffer.from("#!/bin/sh\necho hi")).ok, false);
  assert.equal(inspectBuild("tool.py", Buffer.from("#!/usr/bin/env python\nprint(1)")).ok, true, "a .py may start with a shebang");
});
ok("unsupported and empty and oversized files are rejected", () => {
  assert.equal(inspectBuild("a.docx", Buffer.from("x")).ok, false);
  assert.equal(inspectBuild("a.ex5", Buffer.alloc(0)).ok, false);
  assert.equal(inspectBuild("a.ex5", Buffer.alloc(MAX_BUILD_BYTES + 1)).ok, false);
});
ok("a zip of EA files passes and lists its entries", () => {
  const zip = makeZip([{ name: "EA.ex5", data: Buffer.from("aaa") }, { name: "settings/tested.set", data: Buffer.from("bbb") }]);
  assert.deepEqual(listZipEntries(zip), ["EA.ex5", "settings/tested.set"]);
  const r = inspectBuild("pack.zip", zip);
  assert.equal(r.ok, true, r.reasons.join(";"));
});
ok("a zip containing a dll / exe / script is rejected with the file name", () => {
  for (const bad of ["lib.dll", "run.exe", "go.bat", "x.ps1", "a.js"]) {
    const r = inspectBuild("pack.zip", makeZip([{ name: "EA.ex5", data: Buffer.from("a") }, { name: bad, data: Buffer.from("b") }]));
    assert.equal(r.ok, false, bad);
    assert.match(r.reasons.join(" "), new RegExp(bad.replace(".", "\\.")));
  }
});
ok("zip path traversal and nested zips are rejected", () => {
  assert.equal(inspectBuild("p.zip", makeZip([{ name: "../evil.ex5", data: Buffer.from("a") }])).ok, false);
  assert.equal(inspectBuild("p.zip", makeZip([{ name: "inner.zip", data: Buffer.from("a") }])).ok, false);
});
ok("a corrupt or non-zip .zip is rejected", () => {
  assert.equal(inspectBuild("p.zip", Buffer.from("this is not a zip at all, just text")).ok, false);
  assert.equal(listZipEntries(Buffer.from("short")), null);
});

const good = {
  title: "Gold EA", description: "d".repeat(MIN_DESCRIPTION_CHARS), media: ["https://x/icon.png"],
  pricing: { model: "one_time", amount: 99, currency: "USD" }, hasBuild: true, acceptTerms: true,
};
ok("a complete listing has nothing missing", () => {
  assert.deepEqual(checkPublishRequirements(good), []);
});
ok("every missing item is named", () => {
  const m = checkPublishRequirements({ ...good, title: " ", description: "short", media: [], pricing: {}, hasBuild: false, acceptTerms: false });
  assert.equal(m.length, 6);
  assert.deepEqual(checkPublishRequirements({ ...good, pricing: { model: "one_time", amount: 0 } }), ["a price"]);
  assert.match(checkPublishRequirements({ ...good, pricing: { model: "one_time", amount: 999999 } })[0], /at most/);
});

console.log(`\n${pass} checks passed.`);
