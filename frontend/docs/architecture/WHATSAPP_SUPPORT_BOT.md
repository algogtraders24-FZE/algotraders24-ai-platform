# AT24 WhatsApp support bot

Status: code merged but DORMANT until the owner finishes the Meta setup below and sets the env vars. Until then the webhook answers 503 and nothing changes.

## What it does

The bot runs on a **separate number** that is not registered in any WhatsApp / WhatsApp Business app. The owner's main Business number (+971 56 735 5276) stays in the Business app for human chats, the catalog and the public contact links.

Why not the same number: tried 2026-10-19 in Meta's own "Add phone number" flow (WhatsApp Manager, Meta app `AT24 Support Assistant`, business portfolio "Pravin Awari"). Meta refused: "This phone number is already registered to a WhatsApp account. To continue, migrate this phone number or disconnect it from the existing account." Migrating would remove the number from the app (chats, catalog, broadcasts). Coexistence (app + API on one number) is, per partner documentation, offered through Embedded Signup by Tech Providers, not in this direct flow; treat it as unavailable unless Meta shows a "connect your existing Business app" QR option. The code below still handles coexistence echoes (`smb_message_echoes`) harmlessly if that ever becomes available.

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

The bot number:

- A new SIM / eSIM (UAE number preferred; Meta can also verify a landline or virtual number by a voice call) that has never been registered in WhatsApp or the Business app. Once it is on the Cloud API it can no longer be used in the normal apps.
- It receives the verification code (SMS or voice) in the "Add number" step.
- Meta business portfolio "Pravin Awari" is the one that owns the Facebook Page; the other portfolio "Algotraders24" is restricted ("can't use this business portfolio to advertise"), so do not use it. The portfolio is still "Unverified business": fine for this bot, Meta may ask for business verification to raise limits.

Steps:

1. developers.facebook.com -> create an app (type: Business) -> add the **WhatsApp** product, attach the Algotraders24 Meta Business portfolio.
2. Use case "Connect with customers through WhatsApp" -> Customize -> Step 2 Production setup -> accept Meta's WhatsApp Business terms -> "Register your WhatsApp phone number" -> Add new number: business info, WhatsApp Business profile (display name, time zone Asia/Dubai, category Professional Services, description), then the **bot number** and its SMS/voice code. (Meta rejects app names that contain "WhatsApp".)
3. Business settings -> System users -> create one, give it the app + the WhatsApp account, generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Note the **Phone number ID** (API Setup page; not the phone number) and the **App secret** (App settings -> Basic).
5. Pick a random **verify token** (any long random string).
6. Vercel env (production): `WHATSAPP_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional `WHATSAPP_OWNER_TELEGRAM_CHAT_ID` (a private chat with the AT24 bot, so "a person is needed" alerts reach the owner's phone; it requires `TELEGRAM_ENABLED`/token already set). Set these **first**, redeploy, then do step 7 (Meta's handshake needs `WHATSAPP_VERIFY_TOKEN` live).
7. WhatsApp -> Configuration -> Webhook: callback URL `https://www.algotraders24.ai/api/webhooks/whatsapp` and the verify token from step 5. Subscribe to **messages** and **smb_message_echoes** (the echo field is what lets the bot step back when you reply by hand).
8. Test from another phone: `hi`, a pricing question, `HUMAN`, `should i buy gold`; then reply by hand from the Business app and check the bot stays quiet for that chat.

Cost: there is no platform or subscription fee; Meta bills per delivered message. Meta's own pricing page (whatsappbusiness.com/products/platform-pricing, read 2026-10-19) says **replies inside the 24-hour customer-service window are free**, and marketing / out-of-window utility / authentication templates are charged by country. Several third-party articles claim that free-form service replies become billable from 1 October 2026; Meta's page lists no such change, so treat it as unconfirmed and check Meta's current rate card before go-live. Set a Meta spending cap either way. This bot sends only in-window replies (no templates), so it should fall in the free category.

## Not in this phase

Outbound templates (purchase / licence / payment notices), a human inbox inside the AT24 admin, conversation history, AI-composed answers. Each needs a decision or a migration and is a separate step.
