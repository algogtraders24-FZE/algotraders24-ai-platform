# AT24 WhatsApp support bot

Status: code merged but DORMANT until the owner finishes the Meta setup below and sets the env vars. Until then the webhook answers 503 and nothing changes.

## What it does

A WhatsApp number (the **bot number**, a separate number from the +971 56 735 5276 business-app number) answers inbound messages:

| Message | Reply |
|---|---|
| greeting (`hi`, `menu`) | short intro + site link |
| a question | the best matching article from the **public** support knowledge base (the same anonymous path as the website widget: `answerGuestQuestion`), plus "Not financial advice." |
| no confident answer, or an account change (cancel, refund, upgrade...) | "passed to our team" + a private Telegram alert to the owner (number, question). No ticket is created: WhatsApp senders are not AT24 users |
| `HUMAN` | same hand-over |
| buy/sell calls, signals, price predictions, return guarantees | polite refusal, no knowledge lookup, no alert |
| `STOP` | acknowledged; the bot never writes first anyway |
| image / voice / file | "I can read text messages only" |

Hard limits (by construction): it only **replies** inside the 24-hour customer-service window (no templates, no outbound marketing), it never reads or changes an account, never gives advice, and answers only from public KB text. Guards: Meta HMAC signature on every POST, message-id dedupe, 8 messages/minute per sender, messages older than 10 minutes ignored, always HTTP 200 to a genuine call.

## Files

- `app/api/webhooks/whatsapp/route.ts` - GET handshake, POST (signature check, then `handleWhatsAppPayload`)
- `services/whatsapp/` - `config`, `signature`, `client`, `messages` (the words + intent routing), `webhook` (the handler)
- `scripts/validate-whatsapp.ts` (`npm run validate:whatsapp`, 72 checks, no network/DB)
- `config/whatsapp.ts` + `components/marketplace/AskOnWhatsApp.tsx` - the click-to-chat button on listing pages (no API needed, already live with the merge)

## Owner setup (the owner does all of this; secrets never go in chat or git)

1. **A new number** that is not registered in any WhatsApp / WhatsApp Business app. Keep +971 56 735 5276 as it is.
2. developers.facebook.com -> create an app (type: Business) -> add the **WhatsApp** product, attach the Algotraders24 Meta Business portfolio.
3. WhatsApp -> API Setup -> **add the phone number**, verify it by SMS/voice, set the display name (Meta reviews it).
4. Business settings -> System users -> create one, give it the app + the WhatsApp account, generate a **permanent token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
5. Note the **Phone number ID** (API Setup page; not the phone number) and the **App secret** (App settings -> Basic).
6. Pick a random **verify token** (any long random string).
7. WhatsApp -> Configuration -> Webhook: callback URL `https://www.algotraders24.ai/api/webhooks/whatsapp`, the verify token from step 6, then subscribe to the **messages** field.
8. Vercel env (production): `WHATSAPP_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, optional `WHATSAPP_OWNER_TELEGRAM_CHAT_ID` (a private chat with the AT24 bot, so "a person is needed" alerts reach the owner's phone; it requires `TELEGRAM_ENABLED`/token already set). Set the **handshake env first**, redeploy, then save the webhook in Meta (the handshake needs `WHATSAPP_VERIFY_TOKEN` live).
9. Test from a personal phone: `hi`, a pricing question, `HUMAN`, `should i buy gold`.

Notes to check on Meta's side before relying on this: current per-message pricing (replies inside the 24-hour window have been free of charge, templates are billed), messaging limits for a new number, and whether Business Verification is needed for your volume. Sending a first message to someone who never wrote to you needs an approved template and their opt-in; this bot deliberately does none of that.

## Not in this phase

Outbound templates (purchase / licence / payment notices), a human inbox inside the AT24 admin, conversation history, AI-composed answers. Each needs a decision or a migration and is a separate step.
