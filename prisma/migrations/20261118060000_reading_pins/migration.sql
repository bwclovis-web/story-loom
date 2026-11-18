-- Ordered reading pins for references beside prose. Pin/unpin never changes
-- RecordLink. scopeDraftId "" means project-level (legacy, no manuscript drafts).

-- CreateTable
CREATE TABLE "ReadingPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "scopeDraftId" TEXT NOT NULL DEFAULT '',
    "recordId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReadingPin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReadingPin_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReadingPin_projectId_scopeDraftId_recordId_key" ON "ReadingPin"("projectId", "scopeDraftId", "recordId");

-- CreateIndex
CREATE INDEX "ReadingPin_projectId_scopeDraftId_idx" ON "ReadingPin"("projectId", "scopeDraftId");

-- CreateIndex
CREATE INDEX "ReadingPin_recordId_idx" ON "ReadingPin"("recordId");
