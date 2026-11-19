-- Weave plot-grid layout: optional story-thread columns and beat→thread
-- associations. Freeform x/y on WeaveBeat stay authoritative for freeform view.
-- layoutMode defaults to freeform so existing grids open unchanged.

ALTER TABLE "WeaveGrid" ADD COLUMN "layoutMode" TEXT NOT NULL DEFAULT 'freeform';

CREATE TABLE "WeaveThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gridId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeaveThread_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "WeaveGrid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WeaveThread_gridId_idx" ON "WeaveThread"("gridId");
CREATE INDEX "WeaveThread_projectId_idx" ON "WeaveThread"("projectId");
CREATE INDEX "WeaveThread_gridId_position_idx" ON "WeaveThread"("gridId", "position");

-- Nullable thread association; clearing a thread sets beat.threadId to NULL via app + FK.
ALTER TABLE "WeaveBeat" ADD COLUMN "threadId" TEXT REFERENCES "WeaveThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WeaveBeat" ADD COLUMN "cellOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "WeaveBeat_threadId_idx" ON "WeaveBeat"("threadId");
