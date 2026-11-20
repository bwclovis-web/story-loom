-- AlterTable
ALTER TABLE "ChapterAnalysisRun" ADD COLUMN "categoriesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "ChapterAnalysisRun" ADD COLUMN "assessmentsJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "ChapterAnalysisRun" ADD COLUMN "diagnosticsJson" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ChapterAnalysisRun" ADD COLUMN "outputTokenAllowance" INTEGER NOT NULL DEFAULT 0;
