// config/whatsapp.ts
// AT24's public WhatsApp number (the WhatsApp Business app number, the same one the contact page links to) and the
// click-to-chat link with an optional pre-filled message. No API, no secret: it only opens a chat in the visitor's WhatsApp.
export const WHATSAPP_NUMBER = "971567355276";

export function whatsappHref(prefill?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  const text = (prefill ?? "").trim().slice(0, 300);
  return text.length > 0 ? `${base}?text=${encodeURIComponent(text)}` : base;
}
