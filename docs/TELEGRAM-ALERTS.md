# AT24 Telegram: personal alerts and AT24's own channel

Everything is **dormant** until the owner creates the bot and sets the environment variables below. Merging the code changes nothing for users.

## What it does

1. **Personal alerts (each user, private chat).** A signed-in user opens *Live Sync > Alerts on Telegram > Connect Telegram*. A one-time link (`https://t.me/<bot>?start=<code>`) opens the AT24 bot; the user presses START and the chat is linked. From then on the user's own Live Sync alerts (margin level, daily loss, drawdown, EA offline, no stop loss) and "a page I watch stopped reporting / is back" notices also arrive in that chat. Two switches (alerts, watch notices), a test message and Disconnect in the dashboard; `/status` and `/stop` in the chat. Free. It only informs: nothing trades or closes anything.
2. **AT24's own channel (automatic, neutral).** The 5-minute sweep (already called by the VPS timer) announces **new marketplace listings** in the channel, once each, with no performance claim. By default only AT24's own listings (seller is an admin) are announced (`TELEGRAM_CHANNEL_ANNOUNCE=admin`; `all` includes sellers; `off` stops). An **optional weekly digest** of public Live Results pages (percent only, drawdown next to gain, no ranking, "not independently verified") exists but is **OFF unless `TELEGRAM_CHANNEL_DIGEST=on`**: it shows performance in public, so keep it off until the lawyer has answered the public-performance question.

## Safety design

- Linking needs a **one-time code created by a signed-in user** (128 random bits, only its SHA-256 stored, 15 minutes, single use). Nobody types a chat id, so nobody can point alerts at someone else's chat.
- **Only private chats** can be linked (groups and channels are ignored). One chat belongs to one user.
- The webhook URL is public, so it requires Telegram's **secret token header**, compared in constant time, before it reads the update. It always answers 200 to a genuine call.
- Messages escape all user-controlled text (titles, page names) so nothing can inject markup; they carry no other user's data; delivery is best effort and **never blocks or fails an alert**; a blocked bot or deleted chat removes the link.
- AT24 never sees a Telegram phone number or password: only the numeric chat id and the public username.

## Owner setup (about 10 minutes, once)

1. In Telegram open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot` (for example `AT24AlertsBot`). BotFather replies with a **token**. It is a secret: it goes only into Vercel and your own shell, never into chat, git or a screenshot.
2. (Optional, for the channel) Create a Telegram **channel** (for example `@at24updates`), then *Administrators > Add administrator > your bot* with permission to post messages.
3. On **Vercel** (Production), add:
   - `TELEGRAM_ENABLED=true`
   - `TELEGRAM_BOT_TOKEN=<token from BotFather>`
   - `TELEGRAM_BOT_USERNAME=<bot username without @>`
   - `TELEGRAM_WEBHOOK_SECRET=<a random string of 16-256 letters/digits/_/->` (invent one; keep a copy for the next step)
   - `TELEGRAM_CHANNEL_ID=@at24updates` (only if you made the channel)
   - leave `TELEGRAM_CHANNEL_ANNOUNCE` and `TELEGRAM_CHANNEL_DIGEST` unset (defaults: AT24's own listings only, no digest)
   Then redeploy.
4. On your PC run `scripts/ops/telegram-setup.ts` (see its header) with the token and the same secret in that shell. It checks the token, registers the webhook and prints the state.
5. Open the bot in Telegram, send `/start` (it answers with how to connect), then use *Live Sync > Connect Telegram* in the dashboard.

## Operations

- Admin API `POST /api/private/admin/telegram`: `announce` (run the listing announcement now), `digest-preview` (the digest text, not posted), `digest`, `post` (a short plain-text announcement, <= 800 characters). Every action is written to the audit log.
- If the bot is blocked by a user the link is removed automatically; they can connect again.
- Tests: `npx tsx scripts/validate-telegram.ts` (95 checks, no network, no database).
