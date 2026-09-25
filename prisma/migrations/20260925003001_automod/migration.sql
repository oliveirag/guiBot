-- CreateTable
CREATE TABLE "AutomodRule" (
    "guildId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "action" TEXT NOT NULL DEFAULT 'delete',
    "limit" INTEGER,
    "duration" INTEGER,

    PRIMARY KEY ("guildId", "rule")
);

-- CreateTable
CREATE TABLE "AutomodSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "bannedWords" TEXT NOT NULL DEFAULT '',
    "allowedDomains" TEXT NOT NULL DEFAULT '',
    "exemptRoles" TEXT NOT NULL DEFAULT '',
    "exemptChannels" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
