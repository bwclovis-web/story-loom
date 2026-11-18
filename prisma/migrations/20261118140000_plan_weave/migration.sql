-- Plan Weave: grids (original / zero-draft map / author rewrite), beats with
-- manuscript + World links and Keep/Cut/Move/Combine/Rebuild decisions, series
-- setup→payoff links, and editable templates that apply as independent copies.
-- Moving a beat never reorders manuscript scenes.

-- CreateTable
CREATE TABLE "WeaveGrid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "viewKind" TEXT NOT NULL,
    "sourceTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeaveGrid_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeaveBeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gridId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT '',
    "manuscriptRecordId" TEXT,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 220,
    "height" INTEGER NOT NULL DEFAULT 140,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeaveBeat_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "WeaveGrid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveBeat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WeaveBeat_manuscriptRecordId_fkey" FOREIGN KEY ("manuscriptRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeaveBeatWorldRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "beatId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeaveBeatWorldRef_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "WeaveBeat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveBeatWorldRef_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WeaveBeatWorldRef_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeaveSetupPayoff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "fromBeatId" TEXT NOT NULL,
    "toBeatId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeaveSetupPayoff_fromBeatId_fkey" FOREIGN KEY ("fromBeatId") REFERENCES "WeaveBeat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveSetupPayoff_toBeatId_fkey" FOREIGN KEY ("toBeatId") REFERENCES "WeaveBeat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeaveTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeaveTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeaveTemplateBeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT '',
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 220,
    "height" INTEGER NOT NULL DEFAULT 140,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "WeaveTemplateBeat_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WeaveTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WeaveGrid_projectId_idx" ON "WeaveGrid"("projectId");

-- CreateIndex
CREATE INDEX "WeaveGrid_projectId_viewKind_idx" ON "WeaveGrid"("projectId", "viewKind");

-- CreateIndex
CREATE INDEX "WeaveBeat_gridId_idx" ON "WeaveBeat"("gridId");

-- CreateIndex
CREATE INDEX "WeaveBeat_projectId_idx" ON "WeaveBeat"("projectId");

-- CreateIndex
CREATE INDEX "WeaveBeat_manuscriptRecordId_idx" ON "WeaveBeat"("manuscriptRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "WeaveBeatWorldRef_beatId_recordId_key" ON "WeaveBeatWorldRef"("beatId", "recordId");

-- CreateIndex
CREATE INDEX "WeaveBeatWorldRef_projectId_idx" ON "WeaveBeatWorldRef"("projectId");

-- CreateIndex
CREATE INDEX "WeaveBeatWorldRef_recordId_idx" ON "WeaveBeatWorldRef"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "WeaveSetupPayoff_fromBeatId_toBeatId_key" ON "WeaveSetupPayoff"("fromBeatId", "toBeatId");

-- CreateIndex
CREATE INDEX "WeaveSetupPayoff_workspaceId_idx" ON "WeaveSetupPayoff"("workspaceId");

-- CreateIndex
CREATE INDEX "WeaveSetupPayoff_toBeatId_idx" ON "WeaveSetupPayoff"("toBeatId");

-- CreateIndex
CREATE INDEX "WeaveTemplate_projectId_idx" ON "WeaveTemplate"("projectId");

-- CreateIndex
CREATE INDEX "WeaveTemplateBeat_templateId_idx" ON "WeaveTemplateBeat"("templateId");
