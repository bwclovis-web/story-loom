"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { CloseIcon } from "@/components/shell/icons";
import { useLayout } from "@/components/shell/LayoutContext";
import { CONTEXT_TABS, type ContextTab } from "@/components/shell/preferences";
import { setUnsaved } from "@/components/shell/unsaved";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { Issue } from "@/domain/issues";
import { RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { DRAFT, RECORD, WRITE } from "@/ui/labels";
import {
  attachRewriteSourceAction,
  detachRewriteSourceAction,
  previewRewriteSourceAction,
} from "../../drafts/actions";
import { saveRecordAction, type FormResult } from "../../actions";
import {
  createNoteAction,
  linkReferenceAction,
  previewReferenceAction,
  unlinkReferenceAction,
  type ReferencePreview,
} from "../../write/actions";

export interface NoteItem {
  id: string;
  title: string;
  body: string;
  revision: number;
  fieldsJson: string;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
}

export interface LinkedItem {
  recordId: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
}

export interface ChoiceItem {
  id: string;
  title: string;
  type: RecordType;
  authorityStatus: AuthorityStatus;
}

export interface SourceItem {
  toRecordId: string;
  toRevisionNumber: number;
  title: string;
  type: string;
  newerThanPin: boolean;
  currentRevision: number;
}

export interface AttachableSource {
  id: string;
  title: string;
  type: string;
  currentRevision: number;
}

const TAB_LABELS: Record<ContextTab, string> = {
  source: DRAFT.sourceTab,
  references: WRITE.references,
  notes: WRITE.notes,
  proofread: WRITE.proofread,
};

const CHOICES_SHOWN = 8;

export function WriteContext({
  id,
  projectId,
  recordId,
  recordTitle,
  isProtected,
  notes,
  linked,
  choices,
  sources,
  attachableSources,
  proofreader,
  overlay,
  onClose,
}: {
  id: string;
  projectId: string;
  recordId: string;
  recordTitle: string;
  isProtected: boolean;
  notes: NoteItem[];
  linked: LinkedItem[];
  choices: ChoiceItem[];
  sources: SourceItem[];
  attachableSources: AttachableSource[];
  proofreader: ReactNode;
  /** Shown over the page on narrow screens; closes with Escape. */
  overlay: boolean;
  onClose: () => void;
}) {
  const idPrefix = useId();
  const { layout, updateLayout } = useLayout();
  const tab = layout.contextTab;
  const tabRefs = useRef<Partial<Record<ContextTab, HTMLButtonElement | null>>>({});

  const choose = (next: ContextTab) => {
    updateLayout({ contextTab: next });
    tabRefs.current[next]?.focus();
  };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = CONTEXT_TABS.indexOf(tab);
    const n = CONTEXT_TABS.length;
    const next =
      e.key === "ArrowRight" ? CONTEXT_TABS[(i + 1) % n]
      : e.key === "ArrowLeft" ? CONTEXT_TABS[(i - 1 + n) % n]
      : e.key === "Home" ? CONTEXT_TABS[0]
      : e.key === "End" ? CONTEXT_TABS[n - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    choose(next);
  };

  return (
    <div
      className="context-inner"
      onKeyDown={(e) => {
        if (overlay && e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="context-head">
        <h2 className="context-title" id={`${id}-title`}>
          {WRITE.contextPanel}
        </h2>
        {overlay ? (
          <button type="button" className="icon-button tip tip-end" aria-label={WRITE.closeContext} data-tooltip={WRITE.closeContext} onClick={onClose}>
            <CloseIcon />
          </button>
        ) : null}
      </div>
      <div role="tablist" aria-label={WRITE.contextPanel} className="context-tabs" onKeyDown={onTabKey}>
        {CONTEXT_TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${idPrefix}-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className="context-tab"
            onClick={() => choose(t)}
          >
            {TAB_LABELS[t]}
            {t === "source" && sources.length ? <span className="nav-count"> {sources.length}</span> : null}
            {t === "notes" && notes.length ? <span className="nav-count"> {notes.length}</span> : null}
            {t === "references" && linked.length ? <span className="nav-count"> {linked.length}</span> : null}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted, so switching tabs never discards a note being written or a proofreading run. */}
      <div role="tabpanel" id={`${idPrefix}-panel-source`} aria-labelledby={`${idPrefix}-tab-source`} hidden={tab !== "source"} className="context-body">
        <Sources projectId={projectId} recordId={recordId} sources={sources} attachable={attachableSources} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-references`} aria-labelledby={`${idPrefix}-tab-references`} hidden={tab !== "references"} className="context-body">
        <References projectId={projectId} recordId={recordId} isProtected={isProtected} linked={linked} choices={choices} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-notes`} aria-labelledby={`${idPrefix}-tab-notes`} hidden={tab !== "notes"} className="context-body">
        <Notes projectId={projectId} recordId={recordId} recordTitle={recordTitle} notes={notes} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-proofread`} aria-labelledby={`${idPrefix}-tab-proofread`} hidden={tab !== "proofread"} className="context-body">
        {proofreader}
      </div>
    </div>
  );
}

function Sources({
  projectId,
  recordId,
  sources,
  attachable,
}: {
  projectId: string;
  recordId: string;
  sources: SourceItem[];
  attachable: AttachableSource[];
}) {
  const idPrefix = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{
    toRecordId: string;
    title: string;
    body: string;
    revisionNumber: number;
    currentRevision: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (s: SourceItem) => {
    setError(null);
    startTransition(async () => {
      const result = await previewRewriteSourceAction(projectId, s.toRecordId, s.toRevisionNumber);
      if (!result.ok) {
        setError(result.issues.map((i) => i.message).join(" "));
        return;
      }
      setPreview({
        toRecordId: s.toRecordId,
        title: result.title,
        body: result.body,
        revisionNumber: result.revisionNumber,
        currentRevision: result.currentRevision,
      });
    });
  };

  return (
    <div className="stack">
      <section aria-labelledby={`${idPrefix}-sources`}>
        <h3 id={`${idPrefix}-sources`}>{DRAFT.sourceHeading}</h3>
        {sources.length === 0 ? (
          <p className="small muted">{DRAFT.noSources}</p>
        ) : (
          <ul className="nav-list">
            {sources.map((s) => (
              <li key={s.toRecordId} className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
                <span>
                  {s.title}{" "}
                  <span className="small muted">{DRAFT.sourceRevision(s.toRevisionNumber)}</span>
                  {s.newerThanPin ? <span className="small muted"> · {DRAFT.sourceNewer}</span> : null}
                </span>
                <button type="button" className="secondary small-button" disabled={pending} onClick={() => open(s)}>
                  {DRAFT.openSourcePreview}
                </button>
                <button
                  type="button"
                  className="secondary small-button"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      await detachRewriteSourceAction(projectId, recordId, s.toRecordId);
                      setPreview((p) => (p?.toRecordId === s.toRecordId ? null : p));
                      router.refresh();
                    });
                  }}
                >
                  {DRAFT.detachSource}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {preview ? (
        <section className="reference-preview" aria-label={preview.title}>
          <div className="row">
            <strong>{preview.title}</strong>
            <span className="small muted">{DRAFT.sourceRevision(preview.revisionNumber)}</span>
            <button type="button" className="secondary small-button" onClick={() => setPreview(null)}>
              {DRAFT.closeSourcePreview}
            </button>
          </div>
          <div className="reference-text document">{preview.body || WRITE.noLinkedReferences}</div>
        </section>
      ) : null}
      {attachable.length ? (
        <section aria-labelledby={`${idPrefix}-attach`}>
          <h3 id={`${idPrefix}-attach`}>{DRAFT.attachSource}</h3>
          <ul className="nav-list">
            {attachable.map((a) => (
              <li key={a.id} className="row">
                <span>
                  {a.title}{" "}
                  <span className="small muted">{DRAFT.sourceRevision(a.currentRevision)}</span>
                </span>
                <button
                  type="button"
                  className="secondary small-button"
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      await attachRewriteSourceAction(projectId, recordId, a.id);
                      router.refresh();
                    });
                  }}
                >
                  {DRAFT.attachSource}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {error ? <p className="issue error">{error}</p> : null}
    </div>
  );
}

function References({
  projectId,
  recordId,
  isProtected,
  linked,
  choices,
}: {
  projectId: string;
  recordId: string;
  isProtected: boolean;
  linked: LinkedItem[];
  choices: ChoiceItem[];
}) {
  const idPrefix = useId();
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewRef = useRef<HTMLElement>(null);

  const linkedIds = useMemo(() => new Set(linked.map((l) => l.recordId)), [linked]);
  const available = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return choices.filter(
      (c) => !linkedIds.has(c.id) && (!q || c.title.toLocaleLowerCase().includes(q) || RECORD_TYPE_LABELS[c.type].toLocaleLowerCase().includes(q)),
    );
  }, [choices, linkedIds, query]);
  const shown = available.slice(0, CHOICES_SHOWN);

  const run = (action: () => Promise<FormResult>) =>
    startTransition(async () => {
      const result = await action();
      setIssues(result.ok ? [] : (result.issues ?? []));
    });

  const open = async (id: string) => {
    setPreviewing(id);
    const result = await previewReferenceAction(projectId, id);
    setPreviewing(null);
    setPreview(result);
  };

  useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);

  return (
    <div className="stack">
      {preview ? (
        <section className="reference-preview" ref={previewRef} tabIndex={-1} aria-labelledby={`${idPrefix}-preview`}>
          {preview.ok ? (
            <>
              <h3 id={`${idPrefix}-preview`}>{preview.title}</h3>
              <p className="row small muted">
                {preview.typeLabel} <StatusBadge status={preview.authorityStatus} /> revision {preview.revision}
              </p>
              <div className="reference-text document">{preview.body || <span className="muted">(empty)</span>}</div>
            </>
          ) : (
            <p id={`${idPrefix}-preview`} className="error-text">
              {preview.message}
            </p>
          )}
          <div className="row">
            {preview.ok ? (
              <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(preview.id)}`} className="small">
                {WRITE.openFull}
              </Link>
            ) : null}
            <button type="button" className="secondary small-button" onClick={() => setPreview(null)}>
              {WRITE.closeReference}
            </button>
          </div>
        </section>
      ) : null}

      <section aria-labelledby={`${idPrefix}-linked`}>
        <h3 id={`${idPrefix}-linked`}>{WRITE.linkedReferences}</h3>
        {linked.length === 0 ? (
          <p className="small muted">{WRITE.noLinkedReferences}</p>
        ) : (
          <ul className="context-list">
            {linked.map((l) => (
              <li key={l.recordId}>
                <span className="context-item-title" title={l.title}>
                  {l.title}
                </span>
                <span className="small muted">{RECORD_TYPE_LABELS[l.type]}</span>
                <div className="row">
                  <button type="button" className="secondary small-button" onClick={() => void open(l.recordId)} disabled={previewing === l.recordId}>
                    {WRITE.openReference}
                    <span className="sr-only"> {l.title}</span>
                  </button>
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending}
                    onClick={() => run(() => unlinkReferenceAction(projectId, recordId, l.recordId))}
                  >
                    {WRITE.unlinkReference}
                    <span className="sr-only"> {l.title}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-find`}>
        <h3 id={`${idPrefix}-find`}>{WRITE.findReference}</h3>
        {choices.length === 0 ? (
          <p className="small muted">{WRITE.noReferences}</p>
        ) : (
          <>
            <label>
              <span className="sr-only">{WRITE.findReference}</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={WRITE.findReference} />
            </label>
            <p className="small muted" role="status">
              {WRITE.showingChoices(shown.length, available.length)}
            </p>
            <ul className="context-list">
              {shown.map((c) => (
                <li key={c.id}>
                  <span className="context-item-title" title={c.title}>
                    {c.title}
                  </span>
                  <span className="small muted">{RECORD_TYPE_LABELS[c.type]}</span>
                  <div className="row">
                    <button
                      type="button"
                      className="small-button"
                      disabled={pending}
                      onClick={() => run(() => linkReferenceAction(projectId, recordId, c.id))}
                    >
                      {WRITE.linkReference}
                      <span className="sr-only"> {c.title}</span>
                    </button>
                    <button type="button" className="secondary small-button" onClick={() => void open(c.id)} disabled={previewing === c.id}>
                      {WRITE.openReference}
                      <span className="sr-only"> {c.title}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {isProtected ? <p className="small muted">{WRITE.referenceProtectedNote}</p> : null}
      <IssueList issues={issues} />
    </div>
  );
}

function Notes({
  projectId,
  recordId,
  recordTitle,
  notes,
}: {
  projectId: string;
  recordId: string;
  recordTitle: string;
  notes: NoteItem[];
}) {
  const idPrefix = useId();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="stack">
      <section aria-labelledby={`${idPrefix}-notes`}>
        <h3 id={`${idPrefix}-notes`}>{WRITE.notesFor(recordTitle)}</h3>
        {notes.length === 0 ? (
          <p className="small muted">{WRITE.noNotes}</p>
        ) : (
          <ul className="context-list notes">
            {notes.map((n) =>
              editing === n.id ? (
                <li key={n.id}>
                  <NoteEditor key={n.revision} projectId={projectId} note={n} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={n.id}>
                  <span className="context-item-title">{n.title}</span>
                  <div className="note-text">{n.body}</div>
                  <div className="row">
                    <button type="button" className="secondary small-button" onClick={() => setEditing(n.id)}>
                      {WRITE.editNote}
                      <span className="sr-only"> {n.title}</span>
                    </button>
                    <span className="small muted">revision {n.revision}</span>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
      <NewNote projectId={projectId} recordId={recordId} />
    </div>
  );
}

function NoteEditor({ projectId, note, onDone }: { projectId: string; note: NoteItem; onDone: () => void }) {
  const [dirty, setDirty] = useState(false);
  // Closes only once the server has accepted the save.
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, formData) => {
    const result = await saveRecordAction(projectId, note.id, prev, formData);
    if (result.ok) {
      setDirty(false);
      onDone();
    }
    return result;
  }, { ok: true });
  const key = `note-${note.id}`;

  useEffect(() => {
    setUnsaved(key, dirty);
    return () => setUnsaved(key, false);
  }, [key, dirty]);

  return (
    <form className="stack" onSubmit={submitWithoutReset(action)} onInput={() => setDirty(true)}>
      <input type="hidden" name="expectedRevision" value={note.revision} />
      <input type="hidden" name="authorityStatus" value={note.authorityStatus} />
      <input type="hidden" name="fields" value={note.fieldsJson} />
      <label>
        {WRITE.noteTitle}
        <input type="text" name="title" defaultValue={note.title} required />
      </label>
      <label>
        {WRITE.noteText}
        <textarea name="body" defaultValue={note.body} rows={6} />
      </label>
      {note.isProtected ? (
        <label className="inline">
          <input type="checkbox" name="unlockProtected" />
          {RECORD.unlockProtected}
        </label>
      ) : null}
      {!state.ok ? <IssueList issues={state.issues ?? []} /> : null}
      {!state.ok && state.message ? <p className="error-text small">{state.message}</p> : null}
      <div className="row">
        <button type="submit" className="small-button" disabled={pending}>
          {pending ? WRITE.saving : WRITE.saveNote}
        </button>
        <button type="button" className="secondary small-button" onClick={onDone}>
          {WRITE.closeNote}
        </button>
      </div>
    </form>
  );
}

function NewNote({ projectId, recordId }: { projectId: string; recordId: string }) {
  const idPrefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  // The form is cleared only after the server has saved the note.
  const [state, action, pending] = useActionState<FormResult, FormData>(async (prev, formData) => {
    const result = await createNoteAction(projectId, recordId, prev, formData);
    if (result.ok) {
      formRef.current?.reset();
      setDirty(false);
    }
    return result;
  }, { ok: true });
  const key = `new-note-${recordId}`;

  useEffect(() => {
    setUnsaved(key, dirty);
    return () => setUnsaved(key, false);
  }, [key, dirty]);

  return (
    <form
      ref={formRef}
      className="stack new-note"
      aria-labelledby={`${idPrefix}-new`}
      onSubmit={submitWithoutReset(action)}
      onInput={() => setDirty(true)}
    >
      <h3 id={`${idPrefix}-new`}>{WRITE.newNote}</h3>
      <label>
        {WRITE.noteTitle}
        <input type="text" name="title" required />
      </label>
      <label>
        {WRITE.noteText}
        <textarea name="body" rows={4} />
      </label>
      {!state.ok ? <IssueList issues={state.issues ?? []} /> : null}
      {!state.ok && state.message ? <p className="error-text small">{state.message}</p> : null}
      <div>
        <button type="submit" className="small-button" disabled={pending}>
          {pending ? WRITE.saving : WRITE.addNote}
        </button>
      </div>
    </form>
  );
}
