import Link from "next/link";
import { ContentClassBadge, ProtectionBadge, RevisionBadge, StatusBadge } from "@/components/Badges";
import { OverflowDisclosure } from "@/components/shell/OverflowDisclosure";
import { isManuscriptType, RECORD_TYPE_LABELS, requiresParent, type RecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { listRecords } from "@/server/services/recordService";
import { getSpellingLanguage } from "@/server/spelling";
import { RECORD, SHELL, WRITING } from "@/ui/labels";
import { countWords, formatWordCount } from "@/writing/wordCount";
import { NewRecordForm } from "./NewRecordForm";
import { TypeGroup } from "./TypeGroup";

/** A project's records of the given types, grouped by type, with the new-record form. */
export async function RecordListPage({
  projectId,
  heading,
  lead,
  types,
  defaultType,
  actions,
  hideTypes = [],
  createInOverflow = false,
  children,
}: {
  projectId: string;
  heading: string;
  lead: string;
  types: readonly RecordType[];
  defaultType: RecordType;
  actions?: React.ReactNode;
  /** Types listed by `children` instead of a table here. */
  hideTypes?: readonly RecordType[];
  /** Hide the full create form behind More actions. */
  createInOverflow?: boolean;
  children?: React.ReactNode;
}) {
  const [allRecords, spellingLanguage] = await Promise.all([listRecords(getDb(), projectId), getSpellingLanguage()]);
  const records = allRecords.filter((r) => types.includes(r.type));
  const manuscriptWords = new Map(records.filter((r) => isManuscriptType(r.type)).map((r) => [r.id, countWords(r.body)]));
  const bookWords = [...manuscriptWords.values()].reduce((a, b) => a + b, 0);
  const firstManuscriptType = types.find((t) => isManuscriptType(t) && !hideTypes.includes(t));

  return (
    <>
      <h1>{heading}</h1>
      <p className="page-lead">{lead}</p>
      {actions}
      {children}
      {types.map((type) => {
        const ofType = records.filter((r) => r.type === type);
        if (ofType.length === 0 || hideTypes.includes(type)) return null;
        return (
          <TypeGroup
            key={type}
            title={`${RECORD_TYPE_LABELS[type]} (${ofType.length})`}
          >
            {type === firstManuscriptType ? (
              <p className="small">
                {WRITING.bookCount}: <strong>{formatWordCount(bookWords)}</strong>{" "}
                <span className="muted">{WRITING.bookSavedNote}</span>
              </p>
            ) : null}
            <table className="record-table">
              <tbody>
                {ofType.map((r) => (
                  <tr key={r.id}>
                    <td style={{ width: "40%" }}>
                      <Link href={`/projects/${projectId}/records/${r.id}`}>{r.title}</Link>
                    </td>
                    <td className="muted small">
                      <code>{r.id}</code>
                    </td>
                    <td className="row">
                      <StatusBadge status={r.authorityStatus} />
                      <RevisionBadge revision={r.currentRevision} />
                      <ContentClassBadge contentClass={r.contentClass} />
                      <ProtectionBadge isProtected={r.protected} />
                      {manuscriptWords.has(r.id) ? (
                        <span className="small muted">{formatWordCount(manuscriptWords.get(r.id)!)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TypeGroup>
        );
      })}
      {records.length === 0 ? <p className="muted">No records yet.</p> : null}

      {createInOverflow ? (
        <OverflowDisclosure summary={SHELL.newRecord} className="panel">
          <h2 className="sr-only">{RECORD.newRecordHeading}</h2>
          {types.some(requiresParent) ? <p className="small muted">{RECORD.attachedTypesNote}</p> : null}
          <NewRecordForm projectId={projectId} spellingLanguage={spellingLanguage} defaultType={defaultType} />
        </OverflowDisclosure>
      ) : (
        <section className="panel">
          <h2>{RECORD.newRecordHeading}</h2>
          {types.some(requiresParent) ? <p className="small muted">{RECORD.attachedTypesNote}</p> : null}
          <NewRecordForm projectId={projectId} spellingLanguage={spellingLanguage} defaultType={defaultType} />
        </section>
      )}
    </>
  );
}
