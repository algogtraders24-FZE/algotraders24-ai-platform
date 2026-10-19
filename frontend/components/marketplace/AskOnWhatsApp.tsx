// components/marketplace/AskOnWhatsApp.tsx
// A plain click-to-chat link on a listing page: opens WhatsApp with the product name already typed, so the visitor does not
// have to explain which product they mean. No API and no tracking; the chat goes to AT24's WhatsApp Business number.
import { whatsappHref } from "@/config/whatsapp";

export default function AskOnWhatsApp({ title }: { title: string }) {
  return (
    <a
      href={whatsappHref(`Hi, I have a question about "${title}" on the AT24 Marketplace.`)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-2 rounded-control border border-border px-4 py-3 text-sm font-semibold text-text-2 transition hover:border-gold hover:text-gold"
    >
      Ask a question on WhatsApp
    </a>
  );
}
