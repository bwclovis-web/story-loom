import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { MarkdownView } from "@/components/MarkdownView";
import { CanonBadge } from "@/components/Badges";
import type { RecordView } from "@/domain/records";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { ReferenceInfobox } from "@/components/world/ReferenceInfobox";
import { SERIES } from "@/ui/labels";
import { buildReferenceInfobox } from "@/world/referenceInfobox";
import { seriesBookLabel, seriesRecordHref, type SeriesHomeRef } from "@/world/seriesHome";
import type { KindTemplateView } from "@/world/kindTemplates";
import { parseMarkdown } from "@/writing/markdownParse";

/** A series reference opened from a sibling book. No save, link, or trash controls. */
export function SeriesSharedRecord({
  record,
  home,
  kindTemplates,
}: {
  record: RecordView;
  home: SeriesHomeRef;
  kindTemplates: readonly KindTemplateView[];
}) {
  const book = seriesBookLabel(home);
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
      <p>
        <ButtonLink href={seriesRecordHref(home.projectId, record.id)}>{SERIES.editIn(book)}</ButtonLink>
      </p>
    </>
  );
}
