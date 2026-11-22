-- Continuity Ledger: author can mark an issue intentional or ignored without changing canon text.
CREATE TABLE "ContinuitySuppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actor" TEXT NOT NULL DEFAULT 'author',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContinuitySuppression_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ContinuitySuppression_projectId_issueKey_key" ON "ContinuitySuppression"("projectId", "issueKey");
CREATE INDEX "ContinuitySuppression_projectId_idx" ON "ContinuitySuppression"("projectId");
