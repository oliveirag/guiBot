-- CreateTable
CREATE TABLE "ModCase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userTag" TEXT,
    "moderatorId" TEXT NOT NULL,
    "reason" TEXT,
    "duration" INTEGER,
    "expiresAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "logChannelId" TEXT,
    "logMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ModNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ModSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "dmOnAction" BOOLEAN NOT NULL DEFAULT true,
    "warnThreshold" INTEGER,
    "warnAction" TEXT,
    "warnDuration" INTEGER,
    "lockedChannels" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LogRoute" (
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    PRIMARY KEY ("guildId", "kind")
);

-- CreateIndex
CREATE INDEX "ModCase_guildId_userId_action_idx" ON "ModCase"("guildId", "userId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "ModCase_guildId_number_key" ON "ModCase"("guildId", "number");

-- CreateIndex
CREATE INDEX "ModNote_guildId_userId_idx" ON "ModNote"("guildId", "userId");
