-- CreateTable
CREATE TABLE "DictionaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "word" TEXT NOT NULL,
    "wordKey" TEXT NOT NULL,
    "caseSensitive" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DictionaryEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DictionaryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "ProofreadRun" ADD COLUMN "dictionaryTermCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "DictionaryEntry_workspaceId_projectId_idx" ON "DictionaryEntry"("workspaceId", "projectId");

-- CreateIndex
CREATE INDEX "DictionaryEntry_workspaceId_wordKey_idx" ON "DictionaryEntry"("workspaceId", "wordKey");
