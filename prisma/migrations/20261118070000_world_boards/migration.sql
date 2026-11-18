-- World boards: freeform cards for records, images, and notes. Not revisioned.
-- Removing a card only deletes the BoardCard row. Legacy projects have no boards.

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL DEFAULT 'blank',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoardCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "boardId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT,
    "imageId" TEXT,
    "noteTitle" TEXT NOT NULL DEFAULT '',
    "noteBody" TEXT NOT NULL DEFAULT '',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 220,
    "height" INTEGER NOT NULL DEFAULT 120,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardCard_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoardCard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BoardCard_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BoardCard_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "RecordImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Board_projectId_idx" ON "Board"("projectId");

-- CreateIndex
CREATE INDEX "BoardCard_boardId_idx" ON "BoardCard"("boardId");

-- CreateIndex
CREATE INDEX "BoardCard_projectId_idx" ON "BoardCard"("projectId");

-- CreateIndex
CREATE INDEX "BoardCard_recordId_idx" ON "BoardCard"("recordId");

-- CreateIndex
CREATE INDEX "BoardCard_imageId_idx" ON "BoardCard"("imageId");
