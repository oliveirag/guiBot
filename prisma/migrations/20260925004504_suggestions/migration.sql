-- CreateTable
CREATE TABLE "SuggestionSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT,
    "threads" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "reviewerId" TEXT,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SuggestionVote" (
    "suggestionId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    PRIMARY KEY ("suggestionId", "userId"),
    CONSTRAINT "SuggestionVote_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_guildId_number_key" ON "Suggestion"("guildId", "number");
