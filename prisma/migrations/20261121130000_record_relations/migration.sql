-- CreateTable
CREATE TABLE "RecordRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromRecordId" TEXT NOT NULL,
    "toRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordRelation_fromRecordId_fkey" FOREIGN KEY ("fromRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordRelation_toRecordId_fkey" FOREIGN KEY ("toRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RecordRelation_projectId_idx" ON "RecordRelation"("projectId");

-- CreateIndex
CREATE INDEX "RecordRelation_toRecordId_idx" ON "RecordRelation"("toRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "RecordRelation_fromRecordId_toRecordId_kind_customLabel_key" ON "RecordRelation"("fromRecordId", "toRecordId", "kind", "customLabel");