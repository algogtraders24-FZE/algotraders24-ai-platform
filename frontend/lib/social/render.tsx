// lib/social/render.tsx
// Renders a social card as a JPEG (the Instagram API accepts JPEG only): next/og draws it as PNG, sharp converts. Cards are
// public, cacheable for 5 minutes and marked noindex (they are images for posts, not pages for search).
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const CARD_BG = "#0b0d12";
export const CARD_GOLD = "#d4a73c";
export const CARD_TEXT = "#f3f4f6";
export const CARD_MUTED = "#9ca3af";

export async function renderJpeg(element: ReactElement, width: number, height: number): Promise<Response> {
  const png = Buffer.from(await new ImageResponse(element, { width, height }).arrayBuffer());
  const jpeg = await sharp(png).flatten({ background: CARD_BG }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    status: 200,
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300, s-maxage=300", "x-robots-tag": "noindex" },
  });
}
