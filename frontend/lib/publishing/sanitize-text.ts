// lib/publishing/sanitize-text.ts
// AT24 Publishing Engine (P2.5) - defence-in-depth plain-text sanitizer for
// the public /blog reader.
//
// Article section content is authored prose (the InternalBlogAdapter already
// rejects a raw <script> on the WRITE path). The reader renders it as TEXT
// children in React - which HTML-escapes by default, so there is never a
// `dangerouslySetInnerHTML`. This helper is the second layer: it strips any
// HTML tags and control characters BEFORE the value reaches the DOM, so even
// a value that somehow bypassed the write-path guard (a direct DB edit, the
// legacy publish route) cannot smuggle markup through.
//
// No dependency (P2 rule: no new deps). Pure string transform.

const HTML_TAG = /<\/?[a-z][\s\S]*?>/gi;
const ANGLE_LEFTOVERS = /[<>]/g;

/** Keep only printable characters plus TAB(9) and LF(10); drop other C0
 *  control characters and DEL(127). Done char-by-char so this source file
 *  carries no literal control characters. */
function stripControlChars(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) out += s[i];
  }
  return out;
}

/**
 * Strip HTML tags + control characters and trim. Line breaks and tabs are
 * preserved so `whitespace-pre-wrap` rendering keeps paragraph shape.
 */
export function toSafePlainText(input: unknown): string {
  if (typeof input !== "string") return "";
  return stripControlChars(input.replace(HTML_TAG, "").replace(ANGLE_LEFTOVERS, "")).trim();
}

/** A single-line variant (also collapses internal whitespace) - for titles,
 *  excerpts and meta fields. */
export function toSafeInline(input: unknown): string {
  return toSafePlainText(input).replace(/\s+/g, " ");
}
