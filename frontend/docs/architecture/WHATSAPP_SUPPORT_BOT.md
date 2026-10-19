# AT24 WhatsApp support bot

Status: code merged but DORMANT until the owner finishes the Meta setup below and sets the env vars. Until then the webhook answers 503 and nothing changes.

## What it does

The owner's WhatsApp Business number (+971 56 735 5276) answers inbound messages. Owner decision 2026-10-19: use the SAME number, through Meta's **coexistence** mode (the number keeps working in the WhatsApp Business app AND on the Cloud API). A separate bot number stays the fallback if coexistence is not offered for this number.

| Message | Reply |
|---|---|
| greeting (`hi`, `menu`) | short intro + site link |
| a question | the best matching article from the **public** support knowledge base (the same anonymous path as the website widget: `answerGuestQuestion`), plus "Not financial advice." |
| no confident answer, or an account change (cancel, refund, upgrade...) | "passed to our team" + a private Telegram alert to the owner (number, question). No ticket is created: WhatsApp senders are not AT24 users |
| `HUMAN` | same hand-over |
| buy/sell calls, signals, price predictions, return guarantees | polite refusal, no knowledge lookup, no alert |
| `STOP` | acknowledged; the bot never writes first anyway |
| image / voice / file | "I can read text messages only" |

Human takeover: when the owner writes to a customer from the Business app, Meta delivers it to the webhook as a message echo (`smb_message_echoes`) and the bot stays silent for that customer for 12 hours, so it never talks over a person (best-effort, in memory).

Hard limits (by construction): it only **replies** inside the 24-hour customer-service window (no templates, no outbound marketing), it never reads or changes an account, never gives advice, and answers only from public KB text. Guards: Meta HMAC signature on every POST, message-id dedupe, 8 messages/minute per sender, messages older than 10 minutes ignored, always HTTP 200 to a genuine call.

## Files

- `app/api/webhooks/whatsapp/route.ts` - GET handshake, POST (signature check, then `handleWhatsAppPayload`)
- `services/whatsapp/` - `config`, `signature`, `client`, `messages` (the words + intent routing), `webhook` (the handler)
- `scripts/validate-whatsapp.ts` (`npm run validate:whatsapp`, 72 checks, no network/DB)
- `config/whatsapp.ts` + `components/marketplace/AskOnWhatsApp.tsx` - the click-to-chat button on listing pages (no API needed, already live with the merge)

## Owner setup (the owner does all of this; secrets never go in chat or git)

Same number (coexistence), as reported by Meta's partners (re-check Meta's own page, these come from third-party docs):

- The number must be on the **WhatsApp Business app** (not the normal WhatsApp), app updated (v2.24.17 or newer was quoted), and in active use. Eligibility depends on the account's age and quality; some countries/regions are not supported yet, so Meta's onboarding screen is the real test for the UAE number.
- While connected, **open the Business app at least once every ~13 days** and do not uninstall it, or the link can drop.
- Features that stop working in the app in this mode (as quoted by partners): broadcast lists, status, groups, disappearing messages, message edit/revoke, and others. Check what you use before connecting. Official Business Account (blue tick) is not supported in this mode.
- Throughput is lower than a pure API number (partners quote 5-20 messages/second): irrelevant for a support bot.
- You can disconnect later (Business app: Settings -> Account -> Business Platform); do it deliberately, history can be affected.

Steps:

1. developers.facebook.com -> create an app (type: Business) -> add the **WhatsApp** product, attach the Algotraders24 Meta Business portfolio.
2. WhatsApp -> API Setup -> add the phone number through **Embedded Signup for Business App numbers (coexistence)**. Meta shows a **QR code**: scan it from the Business app on the phone. Let the contact/message-history sync finish (partners quote a 24-hour window).
3. Business settings -> System users -> create one, give it the app + the WhatsApp account, generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Note the **Phone number ID** (API Setup page; not the phone number) and the **App secret** (App settings -> Basic).
5. Pick a random **verify token** (any long random string).
6. Vercel env (production): `WHATSAPP_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional `WHATSAPP_OWNER_TELEGRAM_CHAT_ID` (a private chat with the AT24 bot, so "a person is needed" alerts reach the owner's phone; it requires `TELEGRAM_ENABLED`/token already set). Set these **first**, redeploy, then do step 7 (Meta's handshake needs `WHATSAPP_VERIFY_TOKEN` live).
7. WhatsApp -> Configuration -> Webhook: callback URL `https://www.algotraders24.ai/api/webhooks/whatsapp` and the verify token from step 5. Subscribe to **messages** and **smb_message_echoes** (the echo field is what lets the bot step back when you reply by hand).
8. Test from another phone: `hi`, a pricing question, `HUMAN`, `should i buy gold`; then reply by hand from the Business app and check the bot stays quiet for that chat.

Cost: there is no platform or subscription fee; Meta bills per delivered message. Meta's own pricing page (whatsappbusiness.com/products/platform-pricing, read 2026-10-19) says **replies inside the 24-hour customer-service window are free**, and marketing / out-of-window utility / authentication templates are charged by country. Several third-party articles claim that free-form service replies become billable from 1 October 2026; Meta's page lists no such change, so treat it as unconfirmed and check Meta's current rate card before go-live. Set a Meta spending cap either way. This bot sends only in-window replies (no templates), so it should fall in the free category.

Without coexistence (fallback): register a **new** number on the API only; it then cannot be used in the normal Business app.

## Not in this phase

Outbound templates (purchase / licence / payment notices), a human inbox inside the AT24 admin, conversation history, AI-composed answers. Each needs a decision or a migration and is a separate step.
