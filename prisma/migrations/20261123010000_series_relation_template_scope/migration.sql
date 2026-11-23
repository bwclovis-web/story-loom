-- Additive series-wide relationship and template scope for World Hub W4.
-- Existing rows stay book-local (PlaceRelation/RecordRelation default "book";
-- WorldKindTemplate.worldScope remains NULL = local).

-- Redefine PlaceRelation with scope column (SQLite has no ADD COLUMN DEFAULT that
-- Prisma models as @default for existing tables consistently; recreate is safe).
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PlaceRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromRecordId" TEXT NOT NULL,
    "toRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'book',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaceRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceRelation_fromRecordId_fkey" FOREIGN KEY ("fromRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlaceRelation_toRecordId_fkey" FOREIGN KEY ("toRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PlaceRelation" ("id", "projectId", "fromRecordId", "toRecordId", "kind", "scope", "createdAt")
SELECT "id", "projectId", "fromRecordId", "toRecordId", "kind", 'book', "createdAt" FROM "PlaceRelation";
DROP TABLE "PlaceRelation";
ALTER TABLE "new_PlaceRelation" RENAME TO "PlaceRelation";
CREATE UNIQUE INDEX "PlaceRelation_fromRecordId_toRecordId_kind_key" ON "PlaceRelation"("fromRecordId", "toRecordId", "kind");
CREATE INDEX "PlaceRelation_projectId_idx" ON "PlaceRelation"("projectId");
CREATE INDEX "PlaceRelation_toRecordId_idx" ON "PlaceRelation"("toRecordId");
CREATE INDEX "PlaceRelation_scope_idx" ON "PlaceRelation"("scope");

CREATE TABLE "new_RecordRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromRecordId" TEXT NOT NULL,
    "toRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'book',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordRelation_fromRecordId_fkey" FOREIGN KEY ("fromRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecordRelation_toRecordId_fkey" FOREIGN KEY ("toRecordId") REFERENCES "Record" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RecordRelation" ("id", "projectId", "fromRecordId", "toRecordId", "kind", "customLabel", "scope", "createdAt")
SELECT "id", "projectId", "fromRecordId", "toRecordId", "kind", "customLabel", 'book', "createdAt" FROM "RecordRelation";
DROP TABLE "RecordRelation";
ALTER TABLE "new_RecordRelation" RENAME TO "RecordRelation";
CREATE UNIQUE INDEX "RecordRelation_fromRecordId_toRecordId_kind_customLabel_key" ON "RecordRelation"("fromRecordId", "toRecordId", "kind", "customLabel");
CREATE INDEX "RecordRelation_projectId_idx" ON "RecordRelation"("projectId");
CREATE INDEX "RecordRelation_toRecordId_idx" ON "RecordRelation"("toRecordId");
CREATE INDEX "RecordRelation_scope_idx" ON "RecordRelation"("scope");

ALTER TABLE "WorldKindTemplate" ADD COLUMN "worldScope" TEXT;

PRAGMA foreign_keys=ON;
