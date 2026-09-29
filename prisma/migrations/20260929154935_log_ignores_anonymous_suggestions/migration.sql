-- CreateTable
CREATE TABLE "LogIgnore" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,

    PRIMARY KEY ("guildId", "channelId")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Suggestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "reviewerId" TEXT,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Suggestion" ("authorId", "channelId", "content", "createdAt", "guildId", "id", "messageId", "number", "reason", "reviewerId", "status") SELECT "authorId", "channelId", "content", "createdAt", "guildId", "id", "messageId", "number", "reason", "reviewerId", "status" FROM "Suggestion";
DROP TABLE "Suggestion";
ALTER TABLE "new_Suggestion" RENAME TO "Suggestion";
CREATE UNIQUE INDEX "Suggestion_guildId_number_key" ON "Suggestion"("guildId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
