-- CreateTable
CREATE TABLE "WorldKindTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldKindTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorldKindTemplate_projectId_kind_key" ON "WorldKindTemplate"("projectId", "kind");

-- CreateIndex
CREATE INDEX "WorldKindTemplate_projectId_idx" ON "WorldKindTemplate"("projectId");
