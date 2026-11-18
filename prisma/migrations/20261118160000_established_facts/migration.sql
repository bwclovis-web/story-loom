-- Established-in facts with passage evidence (planned / zero-draft / author-rewrite).
-- Extracted facts stay pending until accepted. Source changes set needsRecheck.

-- CreateTable
CREATE TABLE "EstablishedFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "subjectRecordId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "evidenceKind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EstablishedFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EstablishedFact_subjectRecordId_fkey" FOREIGN KEY ("subjectRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FactEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "factId" TEXT NOT NULL,
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
    CONSTRAINT "FactEvidence_factId_fkey" FOREIGN KEY ("factId") REFERENCES "EstablishedFact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FactEvidence_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EstablishedFact_projectId_idx" ON "EstablishedFact"("projectId");

-- CreateIndex
CREATE INDEX "EstablishedFact_subjectRecordId_idx" ON "EstablishedFact"("subjectRecordId");

-- CreateIndex
CREATE INDEX "EstablishedFact_projectId_status_idx" ON "EstablishedFact"("projectId", "status");

-- CreateIndex
CREATE INDEX "FactEvidence_factId_idx" ON "FactEvidence"("factId");

-- CreateIndex
CREATE INDEX "FactEvidence_projectId_idx" ON "FactEvidence"("projectId");

-- CreateIndex
CREATE INDEX "FactEvidence_sourceRecordId_idx" ON "FactEvidence"("sourceRecordId");

-- CreateIndex
CREATE INDEX "FactEvidence_sourceRecordId_needsRecheck_idx" ON "FactEvidence"("sourceRecordId", "needsRecheck");
