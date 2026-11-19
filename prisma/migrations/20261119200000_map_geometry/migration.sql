-- Route, area, and label geometry on existing map markers.
-- kind defaults to point so current pins stay point markers.
-- points is a JSON array of {x,y} fractions of the image. Empty for points and labels.
-- revision increments when a marker is saved, so a stale write can be refused.
ALTER TABLE "WorldMapPin" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'point';
ALTER TABLE "WorldMapPin" ADD COLUMN "points" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "WorldMapPin" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
