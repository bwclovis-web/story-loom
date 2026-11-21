-- CreateTable
CREATE TABLE "WorldCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldCalendar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorldCalendarMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "daysInMonth" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldCalendarMonth_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorldCalendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldCalendarMonth_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorldCalendarEra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortLabel" TEXT NOT NULL DEFAULT '',
    "yearOffset" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldCalendarEra_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorldCalendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldCalendarEra_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorldCalendar_projectId_key" ON "WorldCalendar"("projectId");

-- CreateIndex
CREATE INDEX "WorldCalendarMonth_projectId_idx" ON "WorldCalendarMonth"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCalendarMonth_calendarId_position_key" ON "WorldCalendarMonth"("calendarId", "position");

-- CreateIndex
CREATE INDEX "WorldCalendarEra_projectId_idx" ON "WorldCalendarEra"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldCalendarEra_calendarId_position_key" ON "WorldCalendarEra"("calendarId", "position");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "timeLabel" TEXT NOT NULL DEFAULT '',
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "draftScope" TEXT NOT NULL DEFAULT 'all',
    "structEraId" TEXT,
    "structYear" INTEGER,
    "structMonthPosition" INTEGER,
    "structDay" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEvent_structEraId_fkey" FOREIGN KEY ("structEraId") REFERENCES "WorldCalendarEra" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StoryEvent" ("createdAt", "draftScope", "id", "planned", "projectId", "revision", "summary", "timeLabel", "title", "updatedAt") SELECT "createdAt", "draftScope", "id", "planned", "projectId", "revision", "summary", "timeLabel", "title", "updatedAt" FROM "StoryEvent";
DROP TABLE "StoryEvent";
ALTER TABLE "new_StoryEvent" RENAME TO "StoryEvent";
CREATE INDEX "StoryEvent_projectId_idx" ON "StoryEvent"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;