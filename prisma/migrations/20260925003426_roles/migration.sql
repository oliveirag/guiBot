-- CreateTable
CREATE TABLE "RolePanel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "style" TEXT NOT NULL DEFAULT 'buttons',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RolePanelOption" (
    "panelId" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emoji" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("panelId", "roleId"),
    CONSTRAINT "RolePanelOption_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "RolePanel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReactionRole" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    PRIMARY KEY ("messageId", "emoji")
);

-- CreateTable
CREATE TABLE "AutoRole" (
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "target" TEXT NOT NULL,

    PRIMARY KEY ("guildId", "roleId", "target")
);

-- CreateIndex
CREATE INDEX "RolePanel_guildId_idx" ON "RolePanel"("guildId");

-- CreateIndex
CREATE INDEX "ReactionRole_guildId_idx" ON "ReactionRole"("guildId");
