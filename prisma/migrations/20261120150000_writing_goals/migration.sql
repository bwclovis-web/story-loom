-- CreateTable
CREATE TABLE "WritingGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "recordId" TEXT,
    "targetWords" INTEGER NOT NULL,
    "deadlineAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WritingGoal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WritingGoal_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WritingGoal_projectId_scope_recordId_key" ON "WritingGoal"("projectId", "scope", "recordId");

-- CreateIndex
CREATE INDEX "WritingGoal_projectId_idx" ON "WritingGoal"("projectId");

-- CreateIndex
CREATE INDEX "WritingGoal_recordId_idx" ON "WritingGoal"("recordId");