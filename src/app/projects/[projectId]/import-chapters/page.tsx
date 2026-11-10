import { HelpHint } from "@/components/HelpHint";
import { CHAPTER_IMPORT, NAV } from "@/ui/labels";
import { ChapterImportClient } from "./ChapterImportClient";

export default async function ImportChaptersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <h1>{NAV.importChapters}</h1>
      <p className="page-lead">{CHAPTER_IMPORT.lead}</p>
      <p className="muted small">
        {CHAPTER_IMPORT.nothingYet} A file that matches an existing chapter (same filename, another version of the same file,
        same title or same text) needs your choice: a new chapter, replace that chapter&apos;s text as a new saved version, or
        skip. Each file&apos;s original name and exact content are kept with the chapter, and the whole import is applied
        together or not at all. Series bibles and other notes belong in {NAV.importMarkdown}.
      </p>
      <HelpHint anchor="import-chapters" topic="importing chapters">
        Chapters are created as protected drafts. Canon status and protection can be changed afterwards on each chapter.
      </HelpHint>
      <ChapterImportClient projectId={projectId} />
    </>
  );
}
