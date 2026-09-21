-- CreateTable
CREATE TABLE "signup_attempts" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "email" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signup_attempts_ip_createdAt_idx" ON "signup_attempts"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "signup_attempts_email_createdAt_idx" ON "signup_attempts"("email", "createdAt");
