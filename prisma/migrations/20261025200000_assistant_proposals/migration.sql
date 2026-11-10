-- AlterTable
ALTER TABLE "AssistantMessage" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'chat';

-- CreateTable
CREATE TABLE "AssistantProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "operationCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME,
    CONSTRAINT "AssistantProposal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantProposal_messageId_key" ON "AssistantProposal"("messageId");

-- CreateIndex
CREATE INDEX "AssistantProposal_projectId_status_idx" ON "AssistantProposal"("projectId", "status");
