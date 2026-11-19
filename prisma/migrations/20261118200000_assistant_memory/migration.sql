-- Conversation summary + project-level assistant preferences (author-approved).

-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN "summary" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ProjectAssistantSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "autoIncludeRecent" BOOLEAN NOT NULL DEFAULT false,
    "recentContextBudgetChars" INTEGER NOT NULL DEFAULT 8000,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectAssistantSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssistantSettings_projectId_key" ON "ProjectAssistantSettings"("projectId");
