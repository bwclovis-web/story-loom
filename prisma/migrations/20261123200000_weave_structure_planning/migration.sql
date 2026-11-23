-- Beat-sheet-first planning foundation. Additive only.
-- Existing Weave grids keep layoutMode / beats / threads unchanged.
-- preferredSurface NULL → UI derives the current default (freeform or chapter grid).
-- New structure-based plans set preferredSurface to beat_sheet.
-- Framework stages are independent copies; starter updates never overwrite them.
-- Story ideas remain WeaveBeat rows. Stage↔idea links are many-to-many.
-- Planning rows are story-grid moments independent of manuscript records.
-- Extra manuscript placements are optional; WeaveBeat.manuscriptRecordId stays the legacy primary.

ALTER TABLE "WeaveGrid" ADD COLUMN "preferredSurface" TEXT;

ALTER TABLE "WeaveBeat" ADD COLUMN "contentRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WeaveBeat" ADD COLUMN "planningRowId" TEXT;

CREATE TABLE "WeaveStructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gridId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourcePresetId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "attribution" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeaveStructure_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "WeaveGrid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveStructure_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WeaveStructure_gridId_idx" ON "WeaveStructure"("gridId");
CREATE INDEX "WeaveStructure_projectId_idx" ON "WeaveStructure"("projectId");
CREATE INDEX "WeaveStructure_gridId_position_idx" ON "WeaveStructure"("gridId", "position");
CREATE INDEX "WeaveStructure_sourcePresetId_idx" ON "WeaveStructure"("sourcePresetId");

CREATE TABLE "WeaveStructureStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "structureId" TEXT NOT NULL,
    "gridId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "guidance" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "groupKey" TEXT NOT NULL DEFAULT '',
    "groupTitle" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeaveStructureStage_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "WeaveStructure" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveStructureStage_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "WeaveGrid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveStructureStage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WeaveStructureStage_structureId_idx" ON "WeaveStructureStage"("structureId");
CREATE INDEX "WeaveStructureStage_gridId_idx" ON "WeaveStructureStage"("gridId");
CREATE INDEX "WeaveStructureStage_projectId_idx" ON "WeaveStructureStage"("projectId");
CREATE INDEX "WeaveStructureStage_structureId_position_idx" ON "WeaveStructureStage"("structureId", "position");
CREATE UNIQUE INDEX "WeaveStructureStage_structureId_stageKey_key" ON "WeaveStructureStage"("structureId", "stageKey");

CREATE TABLE "WeaveStageIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stageId" TEXT NOT NULL,
    "beatId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeaveStageIdea_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WeaveStructureStage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveStageIdea_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "WeaveBeat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveStageIdea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WeaveStageIdea_stageId_beatId_key" ON "WeaveStageIdea"("stageId", "beatId");
CREATE INDEX "WeaveStageIdea_beatId_idx" ON "WeaveStageIdea"("beatId");
CREATE INDEX "WeaveStageIdea_projectId_idx" ON "WeaveStageIdea"("projectId");
CREATE INDEX "WeaveStageIdea_stageId_position_idx" ON "WeaveStageIdea"("stageId", "position");

CREATE TABLE "WeavePlanningRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gridId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeavePlanningRow_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "WeaveGrid" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeavePlanningRow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WeavePlanningRow_gridId_idx" ON "WeavePlanningRow"("gridId");
CREATE INDEX "WeavePlanningRow_projectId_idx" ON "WeavePlanningRow"("projectId");
CREATE INDEX "WeavePlanningRow_gridId_position_idx" ON "WeavePlanningRow"("gridId", "position");

CREATE TABLE "WeaveBeatManuscriptLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "beatId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeaveBeatManuscriptLink_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "WeaveBeat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeaveBeatManuscriptLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WeaveBeatManuscriptLink_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WeaveBeatManuscriptLink_beatId_recordId_key" ON "WeaveBeatManuscriptLink"("beatId", "recordId");
CREATE INDEX "WeaveBeatManuscriptLink_beatId_idx" ON "WeaveBeatManuscriptLink"("beatId");
CREATE INDEX "WeaveBeatManuscriptLink_projectId_idx" ON "WeaveBeatManuscriptLink"("projectId");
CREATE INDEX "WeaveBeatManuscriptLink_recordId_idx" ON "WeaveBeatManuscriptLink"("recordId");

CREATE INDEX "WeaveBeat_planningRowId_idx" ON "WeaveBeat"("planningRowId");
