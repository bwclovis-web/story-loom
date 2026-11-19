-- Markers may link a reference, another map, or both.
-- Existing pins keep their record id and normalized coordinates.
-- markerGroup defaults to places; label defaults to empty.

PRAGMA foreign_keys=OFF;

CREATE TABLE "WorldMapPin_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT,
    "targetMapId" TEXT,
    "markerGroup" TEXT NOT NULL DEFAULT 'places',
    "label" TEXT NOT NULL DEFAULT '',
    "xNorm" REAL NOT NULL,
    "yNorm" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldMapPin_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "WorldMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorldMapPin_targetMapId_fkey" FOREIGN KEY ("targetMapId") REFERENCES "WorldMap" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "WorldMapPin_new" ("id", "mapId", "projectId", "recordId", "targetMapId", "markerGroup", "label", "xNorm", "yNorm", "createdAt")
SELECT "id", "mapId", "projectId", "recordId", NULL, 'places', '', "xNorm", "yNorm", "createdAt" FROM "WorldMapPin";

DROP TABLE "WorldMapPin";
ALTER TABLE "WorldMapPin_new" RENAME TO "WorldMapPin";

CREATE INDEX "WorldMapPin_mapId_idx" ON "WorldMapPin"("mapId");
CREATE INDEX "WorldMapPin_projectId_idx" ON "WorldMapPin"("projectId");
CREATE INDEX "WorldMapPin_recordId_idx" ON "WorldMapPin"("recordId");
CREATE INDEX "WorldMapPin_targetMapId_idx" ON "WorldMapPin"("targetMapId");

PRAGMA foreign_keys=ON;
