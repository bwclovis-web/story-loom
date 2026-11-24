-- AlterTable WorldCalendar: leap rules and week start
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorldCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leapEveryYears" INTEGER,
    "leapSkipYears" INTEGER,
    "leapIncludeYears" INTEGER,
    "leapOffset" INTEGER NOT NULL DEFAULT 0,
    "weekStartOffset" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldCalendar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorldCalendar" ("id", "projectId", "title", "revision", "createdAt", "updatedAt")
SELECT "id", "projectId", "title", "revision", "createdAt", "updatedAt" FROM "WorldCalendar";
DROP TABLE "WorldCalendar";
ALTER TABLE "new_WorldCalendar" RENAME TO "WorldCalendar";
CREATE UNIQUE INDEX "WorldCalendar_projectId_key" ON "WorldCalendar"("projectId");

-- AlterTable WorldCalendarEra: countsDown
CREATE TABLE "new_WorldCalendarEra" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "shortLabel" TEXT NOT NULL DEFAULT '',
    "yearOffset" INTEGER NOT NULL DEFAULT 0,
    "countsDown" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldCalendarEra_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorldCalendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldCalendarEra_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorldCalendarEra" ("id", "calendarId", "projectId", "position", "name", "shortLabel", "yearOffset", "createdAt")
SELECT "id", "calendarId", "projectId", "position", "name", "shortLabel", "yearOffset", "createdAt" FROM "WorldCalendarEra";
DROP TABLE "WorldCalendarEra";
ALTER TABLE "new_WorldCalendarEra" RENAME TO "WorldCalendarEra";
CREATE INDEX "WorldCalendarEra_projectId_idx" ON "WorldCalendarEra"("projectId");
CREATE UNIQUE INDEX "WorldCalendarEra_calendarId_position_key" ON "WorldCalendarEra"("calendarId", "position");

-- CreateTable WorldCalendarWeekday
CREATE TABLE "WorldCalendarWeekday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldCalendarWeekday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorldCalendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldCalendarWeekday_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorldCalendarWeekday_projectId_idx" ON "WorldCalendarWeekday"("projectId");
CREATE UNIQUE INDEX "WorldCalendarWeekday_calendarId_position_key" ON "WorldCalendarWeekday"("calendarId", "position");

-- CreateTable WorldCalendarIntercalary
CREATE TABLE "WorldCalendarIntercalary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "afterMonthPosition" INTEGER NOT NULL,
    "leapMode" TEXT NOT NULL DEFAULT 'always',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldCalendarIntercalary_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorldCalendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldCalendarIntercalary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorldCalendarIntercalary_projectId_idx" ON "WorldCalendarIntercalary"("projectId");
CREATE UNIQUE INDEX "WorldCalendarIntercalary_calendarId_position_key" ON "WorldCalendarIntercalary"("calendarId", "position");

-- CreateTable WorldCalendarFestival
CREATE TABLE "WorldCalendarFestival" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendarId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startMonthPosition" INTEGER NOT NULL,
    "startDay" INTEGER NOT NULL,
    "endMonthPosition" INTEGER NOT NULL,
    "endDay" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldCalendarFestival_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorldCalendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldCalendarFestival_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorldCalendarFestival_projectId_idx" ON "WorldCalendarFestival"("projectId");
CREATE UNIQUE INDEX "WorldCalendarFestival_calendarId_position_key" ON "WorldCalendarFestival"("calendarId", "position");

-- AlterTable StoryEvent: structIntercalaryPosition
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
    "structIntercalaryPosition" INTEGER,
    "structDay" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEvent_structEraId_fkey" FOREIGN KEY ("structEraId") REFERENCES "WorldCalendarEra" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StoryEvent" ("id", "projectId", "title", "summary", "timeLabel", "planned", "draftScope", "structEraId", "structYear", "structMonthPosition", "structDay", "revision", "createdAt", "updatedAt")
SELECT "id", "projectId", "title", "summary", "timeLabel", "planned", "draftScope", "structEraId", "structYear", "structMonthPosition", "structDay", "revision", "createdAt", "updatedAt" FROM "StoryEvent";
DROP TABLE "StoryEvent";
ALTER TABLE "new_StoryEvent" RENAME TO "StoryEvent";
CREATE INDEX "StoryEvent_projectId_idx" ON "StoryEvent"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
