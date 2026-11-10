-- CreateTable
CREATE TABLE "AssistantConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssistantConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssistantConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "replyToId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "model" TEXT,
    "providerResponseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "usageEstimated" BOOLEAN NOT NULL DEFAULT false,
    "includedMessageIds" TEXT NOT NULL DEFAULT '[]',
    "requestChars" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssistantContextItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "passageStart" INTEGER,
    "passageEnd" INTEGER,
    "charCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    CONSTRAINT "AssistantContextItem_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssistantContextItem_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AssistantConversation_workspaceId_projectId_updatedAt_idx" ON "AssistantConversation"("workspaceId", "projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_createdAt_idx" ON "AssistantMessage"("createdAt");

-- CreateIndex
CREATE INDEX "AssistantContextItem_messageId_idx" ON "AssistantContextItem"("messageId");

-- CreateIndex
CREATE INDEX "AssistantContextItem_recordId_idx" ON "AssistantContextItem"("recordId");
