-- CreateTable
CREATE TABLE "WeaveBuildRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT,
    "gridId" TEXT,
    "gridTitle" TEXT NOT NULL DEFAULT '',
    "viewKind" TEXT NOT NULL,
    "chapterFromId" TEXT,
    "chapterToId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "sourceHash" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "sentRevisionsJson" TEXT NOT NULL DEFAULT '{}',
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
    CONSTRAINT "WeaveBuildRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WeaveBuildRun_projectId_createdAt_idx" ON "WeaveBuildRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "WeaveBuildRun_projectId_status_idx" ON "WeaveBuildRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "WeaveBuildRun_gridId_idx" ON "WeaveBuildRun"("gridId");
