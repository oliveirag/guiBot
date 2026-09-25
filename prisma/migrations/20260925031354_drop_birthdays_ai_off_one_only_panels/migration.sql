/*
  Warnings:

  - You are about to drop the `Birthday` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `channelIds` on the `AiSettings` table. All the data in the column will be lost.
  - You are about to drop the column `birthdayChannelId` on the `WelcomeSettings` table. All the data in the column will be lost.
  - You are about to drop the column `birthdayRoleId` on the `WelcomeSettings` table. All the data in the column will be lost.
  - You are about to drop the column `birthdayTime` on the `WelcomeSettings` table. All the data in the column will be lost.
  - You are about to drop the column `birthdayVersion` on the `WelcomeSettings` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `WelcomeSettings` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Birthday_guildId_month_day_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Birthday";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "offChannelIds" TEXT NOT NULL DEFAULT '',
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AiSettings" ("cooldownSeconds", "guildId", "updatedAt") SELECT "cooldownSeconds", "guildId", "updatedAt" FROM "AiSettings";
DROP TABLE "AiSettings";
ALTER TABLE "new_AiSettings" RENAME TO "AiSettings";
CREATE TABLE "new_RolePanel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "style" TEXT NOT NULL DEFAULT 'buttons',
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_RolePanel" ("channelId", "createdAt", "description", "guildId", "id", "messageId", "style", "title") SELECT "channelId", "createdAt", "description", "guildId", "id", "messageId", "style", "title" FROM "RolePanel";
DROP TABLE "RolePanel";
ALTER TABLE "new_RolePanel" RENAME TO "RolePanel";
CREATE INDEX "RolePanel_guildId_idx" ON "RolePanel"("guildId");
CREATE TABLE "new_WelcomeSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "joinChannelId" TEXT,
    "joinMessage" TEXT,
    "joinEmbed" BOOLEAN NOT NULL DEFAULT true,
    "dmMessage" TEXT,
    "leaveChannelId" TEXT,
    "leaveMessage" TEXT,
    "leaveEmbed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_WelcomeSettings" ("dmMessage", "guildId", "joinChannelId", "joinEmbed", "joinMessage", "leaveChannelId", "leaveEmbed", "leaveMessage", "updatedAt") SELECT "dmMessage", "guildId", "joinChannelId", "joinEmbed", "joinMessage", "leaveChannelId", "leaveEmbed", "leaveMessage", "updatedAt" FROM "WelcomeSettings";
DROP TABLE "WelcomeSettings";
ALTER TABLE "new_WelcomeSettings" RENAME TO "WelcomeSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Birthday jobs have no handler anymore.
DELETE FROM "Job" WHERE "type" = 'welcome.birthdays';
