-- Same-project Zero draft and Author manuscript trees, rewrite source pins,
-- and explicit default reading/export drafts. All new columns are nullable so
-- legacy single-draft projects keep opening as they do today.

-- CreateTable
CREATE TABLE "ManuscriptDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManuscriptDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RewriteSourceLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromRecordId" TEXT NOT NULL,
    "toRecordId" TEXT NOT NULL,
    "toRevisionNumber" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewriteSourceLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewriteSourceLink_fromRecordId_fkey" FOREIGN KEY ("fromRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewriteSourceLink_toRecordId_fkey" FOREIGN KEY ("toRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "defaultReadingDraftId" TEXT;
ALTER TABLE "Project" ADD COLUMN "defaultExportDraftId" TEXT;

-- AlterTable
ALTER TABLE "Record" ADD COLUMN "draftId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ManuscriptDraft_projectId_kind_key" ON "ManuscriptDraft"("projectId", "kind");

-- CreateIndex
CREATE INDEX "ManuscriptDraft_projectId_idx" ON "ManuscriptDraft"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "RewriteSourceLink_fromRecordId_toRecordId_key" ON "RewriteSourceLink"("fromRecordId", "toRecordId");

-- CreateIndex
CREATE INDEX "RewriteSourceLink_projectId_idx" ON "RewriteSourceLink"("projectId");

-- CreateIndex
CREATE INDEX "RewriteSourceLink_toRecordId_idx" ON "RewriteSourceLink"("toRecordId");

-- CreateIndex
CREATE INDEX "Record_draftId_idx" ON "Record"("draftId");
