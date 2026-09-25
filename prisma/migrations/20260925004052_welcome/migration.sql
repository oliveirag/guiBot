-- CreateTable
CREATE TABLE "WelcomeSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "joinChannelId" TEXT,
    "joinMessage" TEXT,
    "joinEmbed" BOOLEAN NOT NULL DEFAULT true,
    "dmMessage" TEXT,
    "leaveChannelId" TEXT,
    "leaveMessage" TEXT,
    "leaveEmbed" BOOLEAN NOT NULL DEFAULT false,
    "birthdayChannelId" TEXT,
    "birthdayRoleId" TEXT,
    "birthdayTime" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "birthdayVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Birthday" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,

    PRIMARY KEY ("guildId", "userId")
);

-- CreateIndex
CREATE INDEX "Birthday_guildId_month_day_idx" ON "Birthday"("guildId", "month", "day");
