-- CreateTable
CREATE TABLE "SdMember" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubLogin" TEXT,
    "jiraEmail" TEXT,
    "jiraAccountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("guildId", "userId")
);

-- CreateTable
CREATE TABLE "SdSettings" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SdDeadline" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    "doneAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SdStandup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "day" TEXT NOT NULL,
    "closesAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SdStandupEntry" (
    "standupId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "yesterday" TEXT NOT NULL,
    "today" TEXT NOT NULL,
    "blockers" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("standupId", "userId"),
    CONSTRAINT "SdStandupEntry_standupId_fkey" FOREIGN KEY ("standupId") REFERENCES "SdStandup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SdMeeting" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "startsAt" DATETIME NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "weekly" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SdRsvp" (
    "meetingId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("meetingId", "userId"),
    CONSTRAINT "SdRsvp_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "SdMeeting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SdDeadline_guildId_doneAt_dueAt_idx" ON "SdDeadline"("guildId", "doneAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SdStandup_guildId_day_key" ON "SdStandup"("guildId", "day");

-- CreateIndex
CREATE INDEX "SdMeeting_guildId_startsAt_idx" ON "SdMeeting"("guildId", "startsAt");
