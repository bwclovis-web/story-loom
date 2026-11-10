-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "trashedAt" DATETIME;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "trashedAt" DATETIME;

-- AlterTable
ALTER TABLE "Record" ADD COLUMN "trashedAt" DATETIME;
ALTER TABLE "Record" ADD COLUMN "trashBatchId" TEXT;

-- CreateIndex
CREATE INDEX "Record_trashBatchId_idx" ON "Record"("trashBatchId");
