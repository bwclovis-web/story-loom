-- CreateTable
CREATE TABLE "WorldMapLayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "legacyGroup" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldMapLayer_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "WorldMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorldMapLayer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorldMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "scaleLabel" TEXT NOT NULL DEFAULT '',
    "scaleBarLength" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldMap_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "RecordImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorldMap" ("createdAt", "id", "imageId", "projectId", "title", "updatedAt") SELECT "createdAt", "id", "imageId", "projectId", "title", "updatedAt" FROM "WorldMap";
DROP TABLE "WorldMap";
ALTER TABLE "new_WorldMap" RENAME TO "WorldMap";
CREATE INDEX "WorldMap_projectId_idx" ON "WorldMap"("projectId");
CREATE INDEX "WorldMap_imageId_idx" ON "WorldMap"("imageId");
CREATE TABLE "new_WorldMapPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT,
    "targetMapId" TEXT,
    "markerGroup" TEXT NOT NULL DEFAULT 'places',
    "layerId" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'point',
    "points" TEXT NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "xNorm" REAL NOT NULL,
    "yNorm" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldMapPin_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "WorldMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_targetMapId_fkey" FOREIGN KEY ("targetMapId") REFERENCES "WorldMap" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "WorldMapLayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorldMapPin" ("createdAt", "id", "kind", "label", "mapId", "markerGroup", "points", "projectId", "recordId", "revision", "targetMapId", "xNorm", "yNorm") SELECT "createdAt", "id", "kind", "label", "mapId", "markerGroup", "points", "projectId", "recordId", "revision", "targetMapId", "xNorm", "yNorm" FROM "WorldMapPin";
DROP TABLE "WorldMapPin";
ALTER TABLE "new_WorldMapPin" RENAME TO "WorldMapPin";
CREATE INDEX "WorldMapPin_mapId_idx" ON "WorldMapPin"("mapId");
CREATE INDEX "WorldMapPin_projectId_idx" ON "WorldMapPin"("projectId");
CREATE INDEX "WorldMapPin_recordId_idx" ON "WorldMapPin"("recordId");
CREATE INDEX "WorldMapPin_targetMapId_idx" ON "WorldMapPin"("targetMapId");
CREATE INDEX "WorldMapPin_layerId_idx" ON "WorldMapPin"("layerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WorldMapLayer_projectId_idx" ON "WorldMapLayer"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldMapLayer_mapId_position_key" ON "WorldMapLayer"("mapId", "position");

-- Seed default layers per map and attach pins
INSERT INTO "WorldMapLayer" ("id", "mapId", "projectId", "position", "title", "legacyGroup", "createdAt")
SELECT 'wmly_' || m.id || '_1', m.id, m."projectId", 1, 'Places', 'places', CURRENT_TIMESTAMP FROM "WorldMap" m;
INSERT INTO "WorldMapLayer" ("id", "mapId", "projectId", "position", "title", "legacyGroup", "createdAt")
SELECT 'wmly_' || m.id || '_2', m.id, m."projectId", 2, 'Waterways', 'waterways', CURRENT_TIMESTAMP FROM "WorldMap" m;
INSERT INTO "WorldMapLayer" ("id", "mapId", "projectId", "position", "title", "legacyGroup", "createdAt")
SELECT 'wmly_' || m.id || '_3', m.id, m."projectId", 3, 'Transport', 'transport', CURRENT_TIMESTAMP FROM "WorldMap" m;
INSERT INTO "WorldMapLayer" ("id", "mapId", "projectId", "position", "title", "legacyGroup", "createdAt")
SELECT 'wmly_' || m.id || '_4', m.id, m."projectId", 4, 'Story locations', 'story', CURRENT_TIMESTAMP FROM "WorldMap" m;

UPDATE "WorldMapPin"
SET "layerId" = 'wmly_' || "mapId" || '_1'
WHERE "markerGroup" = 'places' OR "markerGroup" IS NULL OR "markerGroup" = '';

UPDATE "WorldMapPin" SET "layerId" = 'wmly_' || "mapId" || '_2' WHERE "markerGroup" = 'waterways';
UPDATE "WorldMapPin" SET "layerId" = 'wmly_' || "mapId" || '_3' WHERE "markerGroup" = 'transport';
UPDATE "WorldMapPin" SET "layerId" = 'wmly_' || "mapId" || '_4' WHERE "markerGroup" = 'story';