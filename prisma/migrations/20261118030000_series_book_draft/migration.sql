-- Optional Series, Book and Draft assignments. All new columns are nullable so
-- projects without assignments keep opening as they do today.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "seriesName" TEXT;
ALTER TABLE "Project" ADD COLUMN "bookName" TEXT;
ALTER TABLE "Project" ADD COLUMN "draftKind" TEXT;
ALTER TABLE "Project" ADD COLUMN "assignmentRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ManuscriptGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "draftKind" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManuscriptGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Record" ADD COLUMN "groupId" TEXT;
ALTER TABLE "Record" ADD COLUMN "worldScope" TEXT;

-- CreateIndex
CREATE INDEX "ManuscriptGroup_projectId_idx" ON "ManuscriptGroup"("projectId");

-- CreateIndex
CREATE INDEX "Record_groupId_idx" ON "Record"("groupId");
