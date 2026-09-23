-- CreateTable
CREATE TABLE "DevFeed" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DevEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deliveryId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actor" TEXT,
    "actorName" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "detail" TEXT,
    "count" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DevFeed_source_key_idx" ON "DevFeed"("source", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DevFeed_guildId_source_key_key" ON "DevFeed"("guildId", "source", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DevEvent_deliveryId_key" ON "DevEvent"("deliveryId");

-- CreateIndex
CREATE INDEX "DevEvent_source_key_createdAt_idx" ON "DevEvent"("source", "key", "createdAt");

-- CreateIndex
CREATE INDEX "DevEvent_actor_createdAt_idx" ON "DevEvent"("actor", "createdAt");
