-- Evidence-based Living Character Profile analysis runs.
-- Findings stay on the run until the author accepts them via a change package.
CREATE TABLE "CharacterAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "characterRecordIdsJson" TEXT NOT NULL DEFAULT '[]',
    "scopeKind" TEXT NOT NULL,
    "scopeSpecJson" TEXT NOT NULL DEFAULT '{}',
    "actionsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "totalSegments" INTEGER NOT NULL DEFAULT 0,
    "completedSegments" INTEGER NOT NULL DEFAULT 0,
    "currentSegmentLabel" TEXT NOT NULL DEFAULT '',
    "segmentsJson" TEXT NOT NULL DEFAULT '[]',
    "segmentResultsJson" TEXT NOT NULL DEFAULT '[]',
    "findingsJson" TEXT NOT NULL DEFAULT '[]',
    "decisionsJson" TEXT NOT NULL DEFAULT '{}',
    "omissionsJson" TEXT NOT NULL DEFAULT '[]',
    "appliedPackageIdsJson" TEXT NOT NULL DEFAULT '[]',
    "sourceHash" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "usageEstimated" BOOLEAN NOT NULL DEFAULT false,
    "requestChars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "CharacterAnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CharacterAnalysisRun_projectId_createdAt_idx" ON "CharacterAnalysisRun"("projectId", "createdAt");
CREATE INDEX "CharacterAnalysisRun_projectId_status_idx" ON "CharacterAnalysisRun"("projectId", "status");
