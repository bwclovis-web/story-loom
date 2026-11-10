import Link from "next/link";
import { RECORD_TYPE_LABELS, isRecordType } from "@/domain/recordTypes";
import { XREF } from "@/ui/labels";
import { isFlaggedStatus, type RecordCrossRefs, type XrefTarget } from "@/writing/crossRefs";
import { SectionTagBadge, StatusBadge } from "./Badges";

function recordHref(projectId: string, recordId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

/** A warning when the target record is superseded or a draft, with its replacement when there is one. */
export function TargetStatus({ projectId, target }: { projectId: string; target: Pick<XrefTarget, "status" | "replacedBy"> }) {
  if (!isFlaggedStatus(target.status)) return null;
  return (
    <div className={`small ${target.status === "superseded" ? "warning-text" : "muted"}`}>
      <StatusBadge status={target.status} /> {XREF.flagged(target.status)}
      {target.replacedBy ? (
        <>
          {" "}
          {XREF.replacedBy} <Link href={recordHref(projectId, target.replacedBy.recordId)}>{target.replacedBy.title}</Link>.
        </>
      ) : null}
    </div>
  );
}

/** Where a cross-reference points: the record, and the heading when there is one. */
export function xrefHref(projectId: string, currentRecordId: string, target: XrefTarget): string {
  const hash = target.anchor ? `#${target.anchor}` : "";
  if (target.recordId === currentRecordId && hash) return hash;
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(target.recordId)}${hash}`;
}

function typeLabel(type: string): string {
  return isRecordType(type) ? RECORD_TYPE_LABELS[type] : type;
}

/** Mentions, mentioned-by and IDs for one record. Computed from saved text; read-only. */
export function CrossRefsPanel({ projectId, recordId, refs }: { projectId: string; recordId: string; refs: RecordCrossRefs }) {
  const href = (t: XrefTarget) => xrefHref(projectId, recordId, t);
  const empty =
    !refs.defined.length &&
    !refs.files.length &&
    !refs.ids.length &&
    !refs.mentionedBy.length &&
    !refs.names.length &&
    !refs.nameForms.length;
  if (empty) return <p className="small muted">{XREF.noneFound}</p>;
  return (
    <div className="xref-panel">
      <p className="small muted">{XREF.note}</p>

      {refs.names.length ? (
        <>
          <h3 className="xref-subhead">{XREF.namesHere}</h3>
          <ul className="context-links">
            {refs.names.map((n) => (
              <li key={n.recordId}>
                <Link href={recordHref(projectId, n.recordId)}>{n.title}</Link>{" "}
                <span className="small muted">
                  {typeLabel(n.type)} · {XREF.nameCount(n.count)}
                </span>
                {n.forms.length > 1 || n.forms[0] !== n.title ? <div className="small muted">{n.forms.join(", ")}</div> : null}
                <TargetStatus projectId={projectId} target={{ status: n.status }} />
              </li>
            ))}
          </ul>
          <p className="small muted">{XREF.namesHereNote}</p>
        </>
      ) : null}

      {refs.nameForms.length ? (
        <>
          <h3 className="xref-subhead">{XREF.namedIn}</h3>
          <p className="small muted">{XREF.nameForms(refs.nameForms)}</p>
          {refs.namedIn.length ? (
            <ul className="context-links">
              {refs.namedIn.map((c) => (
                <li key={c.recordId}>
                  <Link href={recordHref(projectId, c.recordId)}>{c.title}</Link>{" "}
                  <span className="small muted">{XREF.nameCount(c.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{XREF.notNamed}</p>
          )}
        </>
      ) : null}

      {refs.defined.length ? (
        <>
          <h3 className="xref-subhead">{XREF.definedHere}</h3>
          <ul className="context-links">
            {refs.defined.map((d, i) => (
              <li key={`${d.id}-${i}`}>
                {d.anchor ? (
                  <a href={href(d)}>
                    <code>{d.id}</code>
                  </a>
                ) : (
                  <code>{d.id}</code>
                )}{" "}
                {d.statusTag ? <SectionTagBadge tag={d.statusTag} /> : null}
                <div className="small muted">
                  {d.via === "refIds" ? XREF.givenToRecord : d.via === "file" ? null : `${XREF.definedIn(d.via)}: ${d.label}`}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {refs.files.length || refs.ids.length ? (
        <>
          <h3 className="xref-subhead">{XREF.mentions}</h3>
          <ul className="context-links">
            {refs.files.map((f) => (
              <li key={`f:${f.filename}`}>
                {f.target ? (
                  <>
                    <Link href={href(f.target)}>{f.target.title}</Link>
                    <div className="small muted">
                      <code>{f.filename}</code>
                    </div>
                    <TargetStatus projectId={projectId} target={f.target} />
                  </>
                ) : (
                  <>
                    <code>{f.filename}</code>
                    <div className="small muted">{XREF.notImported}</div>
                  </>
                )}
              </li>
            ))}
            {refs.ids.map((m) => (
              <li key={`i:${m.id}`}>
                <code>{m.id}</code>{" "}
                {m.target ? (
                  <>
                    <Link href={href(m.target)}>{m.target.recordId === recordId ? m.target.label : m.target.title}</Link>
                    {m.target.statusTag ? (
                      <>
                        {" "}
                        <SectionTagBadge tag={m.target.statusTag} />
                      </>
                    ) : null}
                    {m.target.recordId !== recordId ? <TargetStatus projectId={projectId} target={m.target} /> : null}
                  </>
                ) : (
                  <span className="small muted">{XREF.notDefined}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {refs.mentionedBy.length ? (
        <>
          <h3 className="xref-subhead">{XREF.mentionedBy}</h3>
          <ul className="context-links">
            {refs.mentionedBy.map((m) => (
              <li key={m.recordId}>
                <Link href={recordHref(projectId, m.recordId)}>{m.title}</Link>{" "}
                <span className="small muted">{typeLabel(m.type)}</span>
                <div className="small muted">{XREF.via(m.via)}</div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
