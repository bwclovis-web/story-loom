-- CreateTable
CREATE TABLE "ProofreadRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'proofread',
    "scope" TEXT NOT NULL,
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "model" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "usageEstimated" BOOLEAN NOT NULL DEFAULT false,
    "requestChars" INTEGER NOT NULL,
    "suggestionCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "ProofreadRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProofreadRun_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ProofreadRun_projectId_recordId_createdAt_idx" ON "ProofreadRun"("projectId", "recordId", "createdAt");

-- CreateIndex
CREATE INDEX "ProofreadRun_createdAt_idx" ON "ProofreadRun"("createdAt");
