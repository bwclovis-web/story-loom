-- World maps (image backdrop + normalized pins) and explicit place relationships.
-- Soft-trashed sources: maps/pins hidden. Permanent image delete removes maps.
-- Permanent record delete removes pins and place relations. Moving pins/cards
-- never creates or changes PlaceRelation rows.

-- CreateTable
CREATE TABLE "WorldMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldMap_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "RecordImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorldMapPin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "xNorm" REAL NOT NULL,
    "yNorm" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldMapPin_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "WorldMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlaceRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromRecordId" TEXT NOT NULL,
    "toRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaceRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceRelation_fromRecordId_fkey" FOREIGN KEY ("fromRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceRelation_toRecordId_fkey" FOREIGN KEY ("toRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorldMap_projectId_idx" ON "WorldMap"("projectId");

-- CreateIndex
CREATE INDEX "WorldMap_imageId_idx" ON "WorldMap"("imageId");

-- CreateIndex
CREATE INDEX "WorldMapPin_mapId_idx" ON "WorldMapPin"("mapId");

-- CreateIndex
CREATE INDEX "WorldMapPin_projectId_idx" ON "WorldMapPin"("projectId");

-- CreateIndex
CREATE INDEX "WorldMapPin_recordId_idx" ON "WorldMapPin"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceRelation_fromRecordId_toRecordId_kind_key" ON "PlaceRelation"("fromRecordId", "toRecordId", "kind");

-- CreateIndex
CREATE INDEX "PlaceRelation_projectId_idx" ON "PlaceRelation"("projectId");

-- CreateIndex
CREATE INDEX "PlaceRelation_toRecordId_idx" ON "PlaceRelation"("toRecordId");
