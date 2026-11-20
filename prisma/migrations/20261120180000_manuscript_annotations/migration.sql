-- CreateTable
CREATE TABLE "ManuscriptAnnotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "revisionNumber" INTEGER,
    "passageStart" INTEGER,
    "passageEnd" INTEGER,
    "passageExcerpt" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "needsRecheck" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ManuscriptAnnotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManuscriptAnnotation_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ManuscriptAnnotation_projectId_idx" ON "ManuscriptAnnotation"("projectId");
CREATE INDEX "ManuscriptAnnotation_recordId_kind_idx" ON "ManuscriptAnnotation"("recordId", "kind");
CREATE INDEX "ManuscriptAnnotation_projectId_kind_idx" ON "ManuscriptAnnotation"("projectId", "kind");
CREATE INDEX "ManuscriptAnnotation_source_revision_idx" ON "ManuscriptAnnotation"("recordId", "needsRecheck");