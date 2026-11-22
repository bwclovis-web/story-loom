import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { MarkdownView } from "@/components/MarkdownView";
import { CanonBadge } from "@/components/Badges";
import type { RecordView } from "@/domain/records";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { ReferenceInfobox } from "@/components/world/ReferenceInfobox";
import type { ProofreadConfig } from "@/components/writing/Proofreader";
import type { DictionaryWord } from "@/spelling/dictionary";
import { SERIES } from "@/ui/labels";
import { buildReferenceInfobox } from "@/world/referenceInfobox";
import { seriesBookLabel, seriesRecordHref, type SeriesHomeRef } from "@/world/seriesHome";
import type { KindTemplateView } from "@/world/kindTemplates";
import { parseMarkdown } from "@/writing/markdownParse";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { RecordEditor } from "@/app/projects/[projectId]/records/[recordId]/RecordForms";
import { saveSeriesSharedRecordAction } from "@/app/projects/[projectId]/records/[recordId]/seriesSharedActions";

/** A series reference opened from a sibling book. Linking and trash stay on the home book. */
export function SeriesSharedRecord({
  viewingProjectId,
  record,
  home,
  kindTemplates,
  crossEditing,
  editor,
}: {
  viewingProjectId: string;
  record: RecordView;
  home: SeriesHomeRef;
  kindTemplates: readonly KindTemplateView[];
  crossEditing: boolean;
  editor?: {
    spellingLanguage: SpellingLanguage;
    spellChecker: SpellChecker;
    dictionaryWords: DictionaryWord[];
    proofread: ProofreadConfig;
  };
}) {
  const book = seriesBookLabel(home);
  const recordHref = `/projects/${encodeURIComponent(viewingProjectId)}/records/${encodeURIComponent(record.id)}`;
  const infobox = buildReferenceInfobox({
    projectId: home.projectId,
    record,
    bookOrderIds: [],
    crossRefs: { defined: [], files: [], ids: [], mentionedBy: [], names: [], namedIn: [], nameForms: [] },
    acceptedFacts: [],
    placeRelations: null,
    recordRelations: null,
    placements: [],
    kindTemplates,
  });

  if (crossEditing && editor) {
    return (
      <>
        <Banner>{SERIES.crossEditWarning(book)}</Banner>
        <p className="row small muted">
          <span>{RECORD_TYPE_LABELS[record.type]}</span>
          <CanonBadge status={record.authorityStatus} />
          <span>{SERIES.homeBadge(book)}</span>
        </p>
        <RecordEditor
          key={record.currentRevision}
          projectId={viewingProjectId}
          recordId={record.id}
          recordType={record.type}
          revision={record.currentRevision}
          title={record.title}
          body={record.body}
          fieldsJson={JSON.stringify(record.fields, null, 2)}
          authorityStatus={record.authorityStatus}
          isProtected={record.protected}
          isChapter={false}
          otherChaptersWords={null}
          spellingLanguage={editor.spellingLanguage}
          spellChecker={editor.spellChecker}
          dictionaryWords={editor.dictionaryWords}
          proofread={editor.proofread}
          kindTemplates={kindTemplates}
          saveAction={saveSeriesSharedRecordAction}
        />
        <p className="row small muted">
          <ButtonLink href={seriesRecordHref(home.projectId, record.id)} variant="secondary">
            {SERIES.editIn(book)}
          </ButtonLink>
        </p>
      </>
    );
  }

  return (
    <>
      <Banner>
        {SERIES.readOnly(book)}{" "}
        <Link href={seriesRecordHref(home.projectId, record.id)}>{SERIES.editIn(book)}</Link>
      </Banner>
      <p className="row small muted">
        <span>{RECORD_TYPE_LABELS[record.type]}</span>
        <CanonBadge status={record.authorityStatus} />
        <span>{SERIES.homeBadge(book)}</span>
      </p>
      {infobox ? <ReferenceInfobox model={infobox} /> : null}
      <MarkdownView doc={parseMarkdown(record.body)} />
      <p className="row">
        <ButtonLink href={seriesRecordHref(home.projectId, record.id)}>{SERIES.editIn(book)}</ButtonLink>
        <ButtonLink href={`${recordHref}?edit=cross`} variant="secondary">
          {SERIES.editHereCrossBook}
        </ButtonLink>
      </p>
    </>
  );
}