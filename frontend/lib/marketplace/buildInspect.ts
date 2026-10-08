// lib/marketplace/buildInspect.ts
// File hygiene for an uploaded product file (server-side; uses node:crypto for the SHA-256). A filter, not a malware scanner.
import { createHash } from "crypto";
import { ALLOWED_PRODUCT_EXTENSIONS, BLOCKED_EXTENSIONS, MAX_BUILD_BYTES, extensionOf } from "@/lib/marketplace/selfServe";

/** Names of the entries of a ZIP, read from its central directory (no extraction, no dependency). Null = not a readable zip. */
export function listZipEntries(buf: Buffer): string[] | null {
  if (buf.length < 22) return null;
  const minEocd = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < total; n += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    if (off + 46 + nameLen > buf.length) return null;
    names.push(buf.subarray(off + 46, off + 46 + nameLen).toString("utf8"));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export interface BuildInspection {
  ok: boolean;
  reasons: string[];
  sha256: string;
  sizeBytes: number;
  zipEntries?: string[];
}

/** File hygiene for an uploaded product file. Cheap and instant; it is a filter, not a malware scanner. */
export function inspectBuild(fileName: string, buf: Buffer): BuildInspection {
  const reasons: string[] = [];
  const ext = extensionOf(fileName);
  const sha256 = createHash("sha256").update(buf).digest("hex");

  if (buf.length === 0) reasons.push("The file is empty.");
  if (buf.length > MAX_BUILD_BYTES) reasons.push(`The file is larger than the ${MAX_BUILD_BYTES / (1024 * 1024)} MB limit.`);
  if (BLOCKED_EXTENSIONS.includes(ext)) reasons.push(`Files of type ${ext} cannot be sold on the marketplace.`);
  else if (!ALLOWED_PRODUCT_EXTENSIONS.includes(ext)) reasons.push(`Unsupported file type "${ext || "(none)"}". Allowed: ${ALLOWED_PRODUCT_EXTENSIONS.join(" ")}`);

  // A Windows/ELF/script executable renamed to look like a product file.
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) reasons.push("The file is a Windows executable (MZ header), not a trading-platform file.");
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) reasons.push("The file is a Linux executable (ELF header).");
  if (buf.length >= 2 && buf[0] === 0x23 && buf[1] === 0x21 && ext !== ".py") reasons.push("The file starts with a script interpreter line (#!).");

  let zipEntries: string[] | undefined;
  if (ext === ".zip") {
    const entries = listZipEntries(buf);
    if (!entries) reasons.push("The .zip could not be read (corrupt or not a zip file).");
    else {
      zipEntries = entries;
      if (entries.length === 0) reasons.push("The .zip is empty.");
      if (entries.length > 500) reasons.push("The .zip has more than 500 entries.");
      for (const name of entries) {
        if (name.includes("..") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) reasons.push(`Unsafe path inside the .zip: ${name}`);
        const e = extensionOf(name);
        if (BLOCKED_EXTENSIONS.includes(e)) reasons.push(`The .zip contains a ${e} file (${name}) - not allowed.`);
        if (e === ".zip") reasons.push(`The .zip contains another .zip (${name}) - upload the files directly.`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons: Array.from(new Set(reasons)), sha256, sizeBytes: buf.length, zipEntries };
}

