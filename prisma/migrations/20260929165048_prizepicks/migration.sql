-- CreateTable
CREATE TABLE "PpTrack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "baselined" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PpSeen" (
    "guildId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "wagerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("guildId", "profileId", "wagerId")
);

-- CreateIndex
CREATE INDEX "PpTrack_profileId_idx" ON "PpTrack"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "PpTrack_guildId_profileId_key" ON "PpTrack"("guildId", "profileId");
