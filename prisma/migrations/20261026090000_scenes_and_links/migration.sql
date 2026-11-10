-- AlterTable
ALTER TABLE "Record" ADD COLUMN "parentRecordId" TEXT;

-- CreateTable
CREATE TABLE "RecordLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromRecordId" TEXT NOT NULL,
    "toRecordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordLink_fromRecordId_fkey" FOREIGN KEY ("fromRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordLink_toRecordId_fkey" FOREIGN KEY ("toRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Record_parentRecordId_idx" ON "Record"("parentRecordId");

-- CreateIndex
CREATE INDEX "RecordLink_projectId_idx" ON "RecordLink"("projectId");

-- CreateIndex
CREATE INDEX "RecordLink_toRecordId_idx" ON "RecordLink"("toRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordLink_fromRecordId_toRecordId_key" ON "RecordLink"("fromRecordId", "toRecordId");
