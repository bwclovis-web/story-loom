-- CreateTable
CREATE TABLE "CompileProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "titlePageBody" TEXT NOT NULL DEFAULT '',
    "copyrightPageBody" TEXT NOT NULL DEFAULT '',
    "dedicationBody" TEXT NOT NULL DEFAULT '',
    "acknowledgementsBody" TEXT NOT NULL DEFAULT '',
    "sceneBreakGlyph" TEXT NOT NULL DEFAULT '***',
    "chapterHeadingStyle" TEXT NOT NULL DEFAULT 'centered',
    "includeSynopses" BOOLEAN NOT NULL DEFAULT false,
    "includeMarginComments" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompileProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CompileProfile_projectId_key" ON "CompileProfile"("projectId");

-- CreateIndex
CREATE INDEX "CompileProfile_projectId_idx" ON "CompileProfile"("projectId");