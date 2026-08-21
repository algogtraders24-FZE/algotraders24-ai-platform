// lib/marketplace/imageDimensions.ts
// Sprint M12 branding follow-on - stdlib-only pixel-dimension reader for
// PNG/JPEG/WebP/SVG, so the icon-upload endpoint can enforce a real 200x200
// requirement (matching MQL5 Market's own product-icon convention) without
// pulling in an image-processing dependency (sharp etc.) for one check.
// Reads only the header bytes each format needs - never decodes pixel
// data. Returns null (not a guess) when a format variant isn't recognized,
// so the caller can fail open on "can't determine" rather than reject a
// legitimate upload on a parsing gap.

export interface ImageDimensions {
  width: number;
  height: number;
}

function readPng(buf: Buffer): ImageDimensions | null {
  // 8-byte signature, then IHDR is always the first chunk: 4-byte length,
  // "IHDR", 4-byte width, 4-byte height (big-endian).
  if (buf.length < 24) return null;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function readJpeg(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0-SOF15 markers (excluding DHT/JPG/DAC) carry height/width.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (isSof) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  const isRiff = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  if (!isRiff) return null;
  const fourCc = buf.toString("ascii", 12, 16);
  if (fourCc === "VP8X") {
    // Extended format: 24-bit width-1 / height-1 at fixed offsets.
    const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
    return { width, height };
  }
  if (fourCc === "VP8 ") {
    // Lossy: 14-bit width/height (with 2-bit scale flags in the top bits) at offset 26.
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  // VP8L (lossless) uses a bit-packed 14-bit width-1/height-1 field -
  // not worth hand-parsing for one icon-size check; honestly unknown.
  return null;
}

function readSvg(buf: Buffer): ImageDimensions | null {
  const text = buf.toString("utf-8", 0, Math.min(buf.length, 4096));
  const viewBoxMatch = text.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (viewBoxMatch) {
    return { width: Math.round(parseFloat(viewBoxMatch[1])), height: Math.round(parseFloat(viewBoxMatch[2])) };
  }
  const widthMatch = text.match(/<svg[^>]*\swidth\s*=\s*["']?([\d.]+)/i);
  const heightMatch = text.match(/<svg[^>]*\sheight\s*=\s*["']?([\d.]+)/i);
  if (widthMatch && heightMatch) {
    return { width: Math.round(parseFloat(widthMatch[1])), height: Math.round(parseFloat(heightMatch[1])) };
  }
  return null;
}

// Returns null (never a guessed value) when the format/variant isn't
// recognized - callers should fail OPEN on null (allow the upload) since
// this is a UX guardrail, not a security boundary.
export function readImageDimensions(buf: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType === "image/png") return readPng(buf);
  if (mimeType === "image/jpeg") return readJpeg(buf);
  if (mimeType === "image/webp") return readWebp(buf);
  if (mimeType === "image/svg+xml") return readSvg(buf);
  return null;
}
