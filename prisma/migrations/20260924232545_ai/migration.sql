-- CreateTable
CREATE TABLE "AiSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "channelIds" TEXT NOT NULL DEFAULT '',
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SdSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "deadlineChannelId" TEXT,
    "boardMessageId" TEXT,
    "standupChannelId" TEXT,
    "standupTime" TEXT NOT NULL DEFAULT '10:00',
    "standupDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "standupWindowHours" INTEGER NOT NULL DEFAULT 4,
    "standupVersion" INTEGER NOT NULL DEFAULT 0,
    "digestChannelId" TEXT,
    "digestDay" INTEGER NOT NULL DEFAULT 5,
    "digestTime" TEXT NOT NULL DEFAULT '17:00',
    "digestVersion" INTEGER NOT NULL DEFAULT 0,
    "aiDigest" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SdSettings" ("boardMessageId", "deadlineChannelId", "digestChannelId", "digestDay", "digestTime", "digestVersion", "guildId", "standupChannelId", "standupDays", "standupTime", "standupVersion", "standupWindowHours", "timezone", "updatedAt") SELECT "boardMessageId", "deadlineChannelId", "digestChannelId", "digestDay", "digestTime", "digestVersion", "guildId", "standupChannelId", "standupDays", "standupTime", "standupVersion", "standupWindowHours", "timezone", "updatedAt" FROM "SdSettings";
DROP TABLE "SdSettings";
ALTER TABLE "new_SdSettings" RENAME TO "SdSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
