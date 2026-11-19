-- Story events. Not scene locations, mentions, record links, place
-- relationships, or established facts. Empty timeLabel means unknown time.
-- earlier/later rows are chronology, not manuscript order.

-- CreateTable
CREATE TABLE "StoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "timeLabel" TEXT NOT NULL DEFAULT '',
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "draftScope" TEXT NOT NULL DEFAULT 'all',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryEventLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "locationRecordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryEventLocation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StoryEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventLocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventLocation_locationRecordId_fkey" FOREIGN KEY ("locationRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryEventScene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "manuscriptRecordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryEventScene_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StoryEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventScene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventScene_manuscriptRecordId_fkey" FOREIGN KEY ("manuscriptRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryEventOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "earlierEventId" TEXT NOT NULL,
    "laterEventId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryEventOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventOrder_earlierEventId_fkey" FOREIGN KEY ("earlierEventId") REFERENCES "StoryEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventOrder_laterEventId_fkey" FOREIGN KEY ("laterEventId") REFERENCES "StoryEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryEventEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "passageStart" INTEGER NOT NULL,
    "passageEnd" INTEGER NOT NULL,
    "passageExcerpt" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "evidenceKind" TEXT NOT NULL,
    "needsRecheck" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryEventEvidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "StoryEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryEventEvidence_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StoryEvent_projectId_idx" ON "StoryEvent"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryEventLocation_eventId_locationRecordId_key" ON "StoryEventLocation"("eventId", "locationRecordId");

-- CreateIndex
CREATE INDEX "StoryEventLocation_projectId_idx" ON "StoryEventLocation"("projectId");

-- CreateIndex
CREATE INDEX "StoryEventLocation_locationRecordId_idx" ON "StoryEventLocation"("locationRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryEventScene_eventId_manuscriptRecordId_key" ON "StoryEventScene"("eventId", "manuscriptRecordId");

-- CreateIndex
CREATE INDEX "StoryEventScene_projectId_idx" ON "StoryEventScene"("projectId");

-- CreateIndex
CREATE INDEX "StoryEventScene_manuscriptRecordId_idx" ON "StoryEventScene"("manuscriptRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryEventOrder_earlierEventId_laterEventId_key" ON "StoryEventOrder"("earlierEventId", "laterEventId");

-- CreateIndex
CREATE INDEX "StoryEventOrder_projectId_idx" ON "StoryEventOrder"("projectId");

-- CreateIndex
CREATE INDEX "StoryEventOrder_laterEventId_idx" ON "StoryEventOrder"("laterEventId");

-- CreateIndex
CREATE INDEX "StoryEventEvidence_eventId_idx" ON "StoryEventEvidence"("eventId");

-- CreateIndex
CREATE INDEX "StoryEventEvidence_projectId_idx" ON "StoryEventEvidence"("projectId");

-- CreateIndex
CREATE INDEX "StoryEventEvidence_sourceRecordId_idx" ON "StoryEventEvidence"("sourceRecordId");
