/*
  Warnings:

  - You are about to drop the column `lockedChannels` on the `ModSettings` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ModSettings" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "dmOnAction" BOOLEAN NOT NULL DEFAULT true,
    "warnThreshold" INTEGER,
    "warnAction" TEXT,
    "warnDuration" INTEGER,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ModSettings" ("dmOnAction", "guildId", "updatedAt", "warnAction", "warnDuration", "warnThreshold") SELECT "dmOnAction", "guildId", "updatedAt", "warnAction", "warnDuration", "warnThreshold" FROM "ModSettings";
DROP TABLE "ModSettings";
ALTER TABLE "new_ModSettings" RENAME TO "ModSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
