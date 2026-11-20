-- CreateTable
CREATE TABLE "ChapterAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterRecordId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "pinnedRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sourceHash" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "sentMaterialJson" TEXT NOT NULL DEFAULT '',
    "proposalJson" TEXT NOT NULL DEFAULT '',
    "appliedKeysJson" TEXT NOT NULL DEFAULT '[]',
    "decisionsJson" TEXT NOT NULL DEFAULT '{}',
    "model" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "usageEstimated" BOOLEAN NOT NULL DEFAULT false,
    "requestChars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "ChapterAnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChapterAnalysisRun_projectId_createdAt_idx" ON "ChapterAnalysisRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ChapterAnalysisRun_projectId_status_idx" ON "ChapterAnalysisRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "ChapterAnalysisRun_chapterRecordId_idx" ON "ChapterAnalysisRun"("chapterRecordId");
