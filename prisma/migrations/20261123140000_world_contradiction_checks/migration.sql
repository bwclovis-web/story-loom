-- W7B: passage vs approved world-fact contradiction checks (author review).
CREATE TABLE "WorldContradictionCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "manuscriptRecordId" TEXT NOT NULL,
    "manuscriptRevision" INTEGER NOT NULL,
    "passageStart" INTEGER NOT NULL,
    "passageEnd" INTEGER NOT NULL,
    "passageExcerpt" TEXT NOT NULL,
    "passageHash" TEXT NOT NULL,
    "worldRecordId" TEXT NOT NULL,
    "worldRecordRevision" INTEGER NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "storyPointJson" TEXT NOT NULL DEFAULT '{}',
    "storyPointLabel" TEXT NOT NULL DEFAULT '',
    "verdict" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "worldFactFormatted" TEXT NOT NULL,
    "needsRecheck" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldContradictionCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorldContradictionCheck_projectId_dedupeKey_key" ON "WorldContradictionCheck"("projectId", "dedupeKey");
CREATE INDEX "WorldContradictionCheck_projectId_manuscriptRecordId_idx" ON "WorldContradictionCheck"("projectId", "manuscriptRecordId");
CREATE INDEX "WorldContradictionCheck_worldRecordId_needsRecheck_idx" ON "WorldContradictionCheck"("worldRecordId", "needsRecheck");
CREATE INDEX "WorldContradictionCheck_projectId_issueKey_idx" ON "WorldContradictionCheck"("projectId", "issueKey");
