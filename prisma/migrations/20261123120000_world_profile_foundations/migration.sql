-- Living World Profile foundations (W5A): extend WorldKindTemplate for typed
-- profile definitions and add WorldCategoryDefinition for custom categories.
-- Additive only; existing templates keep working with null profile columns.

ALTER TABLE "WorldKindTemplate" ADD COLUMN "definitionId" TEXT;
ALTER TABLE "WorldKindTemplate" ADD COLUMN "label" TEXT;
ALTER TABLE "WorldKindTemplate" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WorldKindTemplate" ADD COLUMN "categorySlug" TEXT;
ALTER TABLE "WorldKindTemplate" ADD COLUMN "subcategorySlug" TEXT;
ALTER TABLE "WorldKindTemplate" ADD COLUMN "profileSpecJson" TEXT;

CREATE INDEX "WorldKindTemplate_definitionId_idx" ON "WorldKindTemplate"("definitionId");

CREATE TABLE "WorldCategoryDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "parentCategorySlug" TEXT,
    "worldScope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorldCategoryDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorldCategoryDefinition_projectId_slug_key" ON "WorldCategoryDefinition"("projectId", "slug");
CREATE INDEX "WorldCategoryDefinition_projectId_idx" ON "WorldCategoryDefinition"("projectId");
CREATE INDEX "WorldCategoryDefinition_worldScope_idx" ON "WorldCategoryDefinition"("worldScope");
