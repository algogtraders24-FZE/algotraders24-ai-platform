# Social outbox (Telegram channel + Instagram / LinkedIn / X via a webhook)

Admin page: `/dashboard/admin/social`. Code: `services/social/*`, cards `app/social/card/*`, cron `/api/private/social/cron/run` (every 15 min).
Test: `npm run validate:social` (15). Table: `social_posts` (additive migration `20261016100000_add_social_posts`).

## What it posts (all measured, never a call)
| kind | when | content |
|---|---|---|
| `daily_card` | weekdays, after 05:30 UTC | JPEG card + caption: the 12-hour expected range of the 7 markets (widened ones marked "US release"), "about 80% of past moves stayed within", link to /markets |
| `scoreboard` | Mondays, after 06:00 UTC | the pooled live hit rate of the stated ranges (12h / 24h); below 30 checked forecasts it says "collecting", never a result |
| `blog` | a new analysis published in the last 26 h | title + clipped excerpt + link, share card |

Every caption carries "Not financial advice. A volatility range, not a direction or a target.", at most 4 hashtags, no buy / sell / target /
guarantee wording (`violatesPolicy` is enforced when approving or editing). A post is created once per `dedupeKey` (`daily:<date>`,
`scoreboard:<date>`, `blog:<slug>`) and sent once; a failed send is retried on the next passes and marked FAILED after 3 attempts.

## Approval
Posts start as **DRAFT**. The admin page shows the real card and an editable caption; **Approve** sends it on the next pass (or press **Run now**).
`SOCIAL_AUTO_APPROVE=on` skips the approval (set it only after a week of drafts you were happy with).

## Channels
* **Telegram channel** - direct: `sendPhoto` to `TELEGRAM_CHANNEL_ID` (the bot must be an admin of the channel). Free.
* **Webhook** - `SOCIAL_WEBHOOK_URL` (+ optional `SOCIAL_WEBHOOK_SECRET`, sent as header `x-at24-secret`). Payload:
  `{ id, kind, title, text, imageUrl, linkUrl }`; `imageUrl` is an absolute **JPEG** (Instagram's API accepts JPEG only). A Make / Zapier / n8n scenario fans
  it out to Instagram (Business/Creator), LinkedIn (company page) and X through those tools' already-approved integrations, which avoids applying for
  LinkedIn's Community Management API or Meta app review ourselves.
* With neither channel configured an approved post reports "No channel is configured" and nothing leaves the platform.

## Make.com scenario (free plan: about 1,000 operations a month)
1. Webhooks > Custom webhook (instant). Copy its URL into Vercel as `SOCIAL_WEBHOOK_URL`.
2. Instagram for Business > Create a photo post: photo URL = `imageUrl`, caption = `text`.
3. LinkedIn > Create a company post: company page = Algotraders24ai, text = `text`, image = `imageUrl`.
4. (X is paid per post since Feb 2026; add later if wanted.)
A daily post uses about 3 operations, so a month of daily + weekly + blog posts stays under the free allowance.

## Not done on purpose
No X posting (paid), no personal-profile posting, no replies / engagement automation, no scraping, no posting from users' accounts.
