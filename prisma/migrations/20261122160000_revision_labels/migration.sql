-- Optional snapshot name on an existing revision. Does not rewrite title, body, or fields.
ALTER TABLE "Revision" ADD COLUMN "label" TEXT;
