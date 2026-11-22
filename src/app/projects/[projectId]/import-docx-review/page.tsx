import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { DOCX_REVIEW, NAV } from "@/ui/labels";
import { DocxReviewClient } from "./DocxReviewClient";

export default async function ImportDocxReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <>
      <ProjectPageHeader projectId={projectId} title={NAV.importDocxReview} description={DOCX_REVIEW.lead} />
      <p className="muted small">{DOCX_REVIEW.nothingYet}</p>
      <HelpHint anchor="import-docx-review" topic="reviewing an editor Word file">
        Export the manuscript as DOCX first so chapter bookmarks match. Tracked changes are shown as the final text versus
        the live chapter; Word comments can become margin comments after you confirm.
      </HelpHint>
      <DocxReviewClient projectId={projectId} />
    </>
  );
}
