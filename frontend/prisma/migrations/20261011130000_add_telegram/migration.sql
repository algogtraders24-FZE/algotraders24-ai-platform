-- AT24 Telegram: personal alerts (linked chats) and the channel announcement log. Additive only: three new tables.

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "alertsOn" BOOLEAN NOT NULL DEFAULT true,
    "watchOn" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_link_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "telegram_channel_posts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "messageId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_channel_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_links_userId_key" ON "telegram_links"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_links_chatId_key" ON "telegram_links"("chatId");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_link_codes_codeHash_key" ON "telegram_link_codes"("codeHash");
CREATE INDEX IF NOT EXISTS "telegram_link_codes_userId_idx" ON "telegram_link_codes"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_channel_posts_kind_refId_key" ON "telegram_channel_posts"("kind", "refId");
