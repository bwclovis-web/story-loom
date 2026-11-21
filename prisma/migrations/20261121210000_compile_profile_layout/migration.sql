-- Compile layout options. Defaults keep existing profiles on the previous export look.
ALTER TABLE "CompileProfile" ADD COLUMN "trimSize" TEXT NOT NULL DEFAULT '6x9';
ALTER TABLE "CompileProfile" ADD COLUMN "marginInches" REAL NOT NULL DEFAULT 0.75;
ALTER TABLE "CompileProfile" ADD COLUMN "runningHeader" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompileProfile" ADD COLUMN "runningFooter" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompileProfile" ADD COLUMN "fontPreset" TEXT NOT NULL DEFAULT 'serif';
ALTER TABLE "CompileProfile" ADD COLUMN "spacingPreset" TEXT NOT NULL DEFAULT 'novel';
ALTER TABLE "CompileProfile" ADD COLUMN "firstParagraphNoIndent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompileProfile" ADD COLUMN "dropCap" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompileProfile" ADD COLUMN "includeToc" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CompileProfile" ADD COLUMN "backMatterBody" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CompileProfile" ADD COLUMN "excludedRecordIds" TEXT NOT NULL DEFAULT '[]';
