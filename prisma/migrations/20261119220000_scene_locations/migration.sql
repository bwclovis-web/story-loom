-- Author-assigned locations for chapters and scenes.
-- Not mentions, record links, place relationships, or established facts.
-- No story date. revision refuses a stale rewrite of the same assignment.

-- CreateTable
CREATE TABLE "SceneLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "manuscriptRecordId" TEXT NOT NULL,
    "locationRecordId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SceneLocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SceneLocation_manuscriptRecordId_fkey" FOREIGN KEY ("manuscriptRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SceneLocation_locationRecordId_fkey" FOREIGN KEY ("locationRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SceneLocation_manuscriptRecordId_locationRecordId_key" ON "SceneLocation"("manuscriptRecordId", "locationRecordId");

-- CreateIndex
CREATE INDEX "SceneLocation_projectId_idx" ON "SceneLocation"("projectId");

-- CreateIndex
CREATE INDEX "SceneLocation_locationRecordId_idx" ON "SceneLocation"("locationRecordId");
