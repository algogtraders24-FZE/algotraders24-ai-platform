# Product announcements (email to users about new development)

Whenever something user-facing ships (a new product/listing, a feature, a major fix), users should hear about it. This is the process.
It is **never automatic**: an admin approves every send.

## How it works
- Dashboard > Admin > **Announcements**: write the email once (subject, preview line, body, optional button), **Send test to me**, then **Send to N users**.
- Sent from `support@algotraders24.ai`; replies go to the support inbox.
- Audience: active, email-verified, not deleted, not unsubscribed, not an internal test address.
- Every email has a signed **Unsubscribe from product updates** link (`/unsubscribe`) and the one-click `List-Unsubscribe` headers. Unsubscribed users are skipped for every future announcement. Account emails (security, purchases, support) are not affected.
- One delivery row per (announcement, user) is claimed before sending, so a double click or a retry can never email anyone twice. Failed recipients can be retried.
- Safety rails: subject/body length, button link must be an `https://*.algotraders24.ai` URL, no buy/sell calls, targets or guarantees, and the risk line is always in the footer.

## Writing a good one
- Say what is new, who it is for, and the honest caveats (same tone as the listing page). No profit claims.
- One clear button. Short paragraphs, 3-5 bullets at most. Body syntax: blank line = new paragraph, `- ` = bullet, `**bold**`.

## Creating a draft from the repo (used by Claude after shipping something)
1. Add `docs/announcements/<name>.json` (`subject`, `preheader`, `bodyText`, `ctaLabel`, `ctaUrl`).
2. `cd frontend && npx tsx --conditions=react-server scripts/create-announcement-draft.ts ../docs/announcements/<name>.json`
3. Open the Announcements tab, send the test, check the inbox (and spam), then send.

Needs `RESEND_API_KEY` (sending) and `UNSUBSCRIBE_SECRET` or `CRON_SECRET` (signing unsubscribe links) in the deployment env. `validate-announcements.ts` checks rendering, escaping, tokens and the content policy (no database needed).
