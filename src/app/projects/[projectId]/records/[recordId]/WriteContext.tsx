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
import { DRAFT, RECORD, WEAVE, WRITE } from "@/ui/labels";
import {
  attachRewriteSourceAction,
  detachRewriteSourceAction,
  previewRewriteSourceAction,
} from "../../drafts/actions";
import { saveRecordAction, type FormResult } from "../../actions";
import {
  addReadingPinAction,
  createNoteAction,
  linkReferenceAction,
  listReadingPinsAction,
  previewReferenceAction,
  removeReadingPinAction,
  reorderReadingPinsAction,
  searchContextReferencesAction,
  unlinkReferenceAction,
  type ReferencePreview,
} from "../../write/actions";
import type { ContextSearchHit } from "@/server/services/searchService";
import type { ReadingPinView } from "@/server/services/readingPinService";

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
  plot: WRITE.plot,
  proofread: WRITE.proofread,
};

export interface PlotBeatItem {
  id: string;
  title: string;
  body: string;
  decisionLabel: string;
  threadTitle: string | null;
  gridId: string;
  gridTitle: string;
}

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
  draftScopeId,
  initialPins,
  plotBeats,
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
  /** Active Write draft id, or null for legacy project-level pins. */
  draftScopeId: string | null;
  initialPins: ReadingPinView[];
  plotBeats: PlotBeatItem[];
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
            {t === "plot" && plotBeats.length ? <span className="nav-count"> {plotBeats.length}</span> : null}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted, so switching tabs never discards a note being written or a proofreading run. */}
      <div role="tabpanel" id={`${idPrefix}-panel-source`} aria-labelledby={`${idPrefix}-tab-source`} hidden={tab !== "source"} className="context-body">
        <Sources projectId={projectId} recordId={recordId} sources={sources} attachable={attachableSources} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-references`} aria-labelledby={`${idPrefix}-tab-references`} hidden={tab !== "references"} className="context-body">
        <References
          projectId={projectId}
          recordId={recordId}
          isProtected={isProtected}
          linked={linked}
          choices={choices}
          draftScopeId={draftScopeId}
          initialPins={initialPins}
        />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-notes`} aria-labelledby={`${idPrefix}-tab-notes`} hidden={tab !== "notes"} className="context-body">
        <Notes projectId={projectId} recordId={recordId} recordTitle={recordTitle} notes={notes} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-plot`} aria-labelledby={`${idPrefix}-tab-plot`} hidden={tab !== "plot"} className="context-body">
        <PlotBeats projectId={projectId} beats={plotBeats} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-proofread`} aria-labelledby={`${idPrefix}-tab-proofread`} hidden={tab !== "proofread"} className="context-body">
        {proofreader}
      </div>
    </div>
  );
}

function PlotBeats({ projectId, beats }: { projectId: string; beats: PlotBeatItem[] }) {
  if (!beats.length) {
    return (
      <p className="rail-empty">
        {WEAVE.writePlotEmpty}{" "}
        <Link href={`/projects/${encodeURIComponent(projectId)}/plan/weave`}>{WEAVE.writePlotOpenGrid}</Link>
      </p>
    );
  }
  return (
    <ul className="write-plot-list">
      {beats.map((beat) => (
        <li key={beat.id} className="write-plot-item">
          <strong>{beat.title}</strong>
          {beat.threadTitle ? (
            <span className="small muted">
              {WEAVE.writePlotThread}: {beat.threadTitle}
            </span>
          ) : null}
          {beat.decisionLabel ? <span className="small muted">{beat.decisionLabel}</span> : null}
          {beat.body ? <p className="small">{beat.body}</p> : null}
          <Link
            href={`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(beat.gridId)}`}
            className="small"
          >
            {beat.gridTitle} — {WEAVE.writePlotOpenGrid}
          </Link>
        </li>
      ))}
    </ul>
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

function matchLabel(matchedIn: ContextSearchHit["matchedIn"]): string {
  switch (matchedIn) {
    case "title":
      return WRITE.matchedInTitle;
    case "name":
      return WRITE.matchedInName;
    case "aliases":
      return WRITE.matchedInAliases;
    case "section":
      return WRITE.matchedInSection;
  }
}

function References({
  projectId,
  recordId,
  isProtected,
  linked,
  choices,
  draftScopeId,
  initialPins,
}: {
  projectId: string;
  recordId: string;
  isProtected: boolean;
  linked: LinkedItem[];
  choices: ChoiceItem[];
  draftScopeId: string | null;
  initialPins: ReadingPinView[];
}) {
  const idPrefix = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContextSearchHit[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [jumpSectionId, setJumpSectionId] = useState<string | null>(null);
  const [pins, setPins] = useState(initialPins);
  const previewRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const linkedIds = useMemo(() => new Set(linked.map((l) => l.recordId)), [linked]);
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.recordId)), [pins]);

  useEffect(() => {
    setPins(initialPins);
  }, [initialPins]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void searchContextReferencesAction(projectId, q).then((result) => {
        if (cancelled) return;
        if (result.ok) setHits(result.hits);
        else setIssues(result.issues);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [projectId, query]);

  const fallbackChoices = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (hits.length || !q) {
      return choices
        .filter(
          (c) =>
            !linkedIds.has(c.id) &&
            (!q || c.title.toLocaleLowerCase().includes(q) || RECORD_TYPE_LABELS[c.type].toLocaleLowerCase().includes(q)),
        )
        .slice(0, CHOICES_SHOWN);
    }
    return [];
  }, [choices, linkedIds, query, hits.length]);

  const run = (action: () => Promise<FormResult>) =>
    startTransition(async () => {
      const result = await action();
      setIssues(result.ok ? [] : (result.issues ?? []));
    });

  const refreshPins = async () => {
    const result = await listReadingPinsAction(projectId, draftScopeId);
    if (result.ok) setPins(result.pins);
  };

  const open = async (id: string, sectionId?: string | null) => {
    setPreviewing(id);
    const result = await previewReferenceAction(projectId, id);
    setPreviewing(null);
    setPreview(result);
    setJumpSectionId(sectionId ?? null);
  };

  useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);

  useEffect(() => {
    if (!preview?.ok || !jumpSectionId || !bodyRef.current) return;
    const el = bodyRef.current.querySelector(`[data-section-id="${CSS.escape(jumpSectionId)}"]`);
    el?.scrollIntoView({ block: "start" });
  }, [preview, jumpSectionId]);

  const pinRecord = (id: string) =>
    startTransition(async () => {
      const result = await addReadingPinAction(projectId, id, draftScopeId);
      setIssues(result.ok ? [] : (result.issues ?? []));
      if (result.ok && result.pins) setPins(result.pins);
      else await refreshPins();
    });

  const unpinRecord = (id: string) =>
    startTransition(async () => {
      const result = await removeReadingPinAction(projectId, id, draftScopeId);
      setIssues(result.ok ? [] : (result.issues ?? []));
      if (result.ok && result.pins) setPins(result.pins);
      else await refreshPins();
    });

  const movePin = (recordId: string, dir: -1 | 1) =>
    startTransition(async () => {
      const ids = pins.map((p) => p.recordId);
      const i = ids.indexOf(recordId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ids.length) return;
      const next = [...ids];
      const [moved] = next.splice(i, 1);
      next.splice(j, 0, moved!);
      const result = await reorderReadingPinsAction(projectId, next, draftScopeId);
      setIssues(result.ok ? [] : (result.issues ?? []));
      if (result.ok && result.pins) setPins(result.pins);
    });

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
              <div className="row reference-preview-actions">
                {pinnedIds.has(preview.id) ? (
                  <button type="button" className="secondary small-button" disabled={pending} onClick={() => unpinRecord(preview.id)}>
                    {WRITE.unpinReference}
                  </button>
                ) : (
                  <button type="button" className="small-button" disabled={pending} onClick={() => pinRecord(preview.id)}>
                    {WRITE.pinReference}
                  </button>
                )}
                {linkedIds.has(preview.id) ? (
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending}
                    onClick={() => run(() => unlinkReferenceAction(projectId, recordId, preview.id))}
                  >
                    {WRITE.unlinkFromScene}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="small-button"
                    disabled={pending}
                    onClick={() => run(() => linkReferenceAction(projectId, recordId, preview.id))}
                  >
                    {WRITE.linkToScene}
                  </button>
                )}
                <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(preview.id)}`} className="small">
                  {WRITE.openFull}
                </Link>
                <button type="button" className="secondary small-button" onClick={() => setPreview(null)}>
                  {WRITE.closeReference}
                </button>
              </div>
              {preview.sections.length ? (
                <div className="reference-jump">
                  <span className="small muted">{WRITE.jumpToSection}:</span>
                  <ul className="context-links">
                    {preview.sections.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          className="linkish small"
                          onClick={() => {
                            setJumpSectionId(s.id);
                            const el = bodyRef.current?.querySelector(`[data-section-id="${CSS.escape(s.id)}"]`);
                            el?.scrollIntoView({ block: "start" });
                          }}
                        >
                          {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.images.length ? (
                <div className="reference-thumbs" aria-label={WRITE.referenceImages}>
                  {preview.images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element -- read-only rail thumbnails from project image route
                    <img
                      key={img.id}
                      src={`/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(img.id)}`}
                      alt={img.altText || img.name}
                      title={img.caption || img.name}
                      width={72}
                      height={72}
                    />
                  ))}
                </div>
              ) : null}
              <div className="reference-text document" ref={bodyRef}>
                {preview.body ? (
                  preview.sections.length ? (
                    <PreviewBody body={preview.body} sections={preview.sections} />
                  ) : (
                    preview.body
                  )
                ) : (
                  <span className="muted">(empty)</span>
                )}
              </div>
            </>
          ) : (
            <>
              <p id={`${idPrefix}-preview`} className="error-text">
                {preview.message}
              </p>
              <button type="button" className="secondary small-button" onClick={() => setPreview(null)}>
                {WRITE.closeReference}
              </button>
            </>
          )}
        </section>
      ) : null}

      <section aria-labelledby={`${idPrefix}-pins`}>
        <h3 id={`${idPrefix}-pins`}>{WRITE.pinnedReferences}</h3>
        <p className="small muted">{WRITE.pinNote}</p>
        {pins.length === 0 ? (
          <p className="small muted">{WRITE.noPins}</p>
        ) : (
          <ul className="context-list">
            {pins.map((p, index) => (
              <li key={p.pinId}>
                <span className="context-item-title" title={p.title}>
                  {p.title}
                </span>
                <span className="small muted">{RECORD_TYPE_LABELS[p.type]}</span>
                <div className="row">
                  <button type="button" className="secondary small-button" onClick={() => void open(p.recordId)} disabled={previewing === p.recordId}>
                    {WRITE.openReference}
                    <span className="sr-only"> {p.title}</span>
                  </button>
                  <button type="button" className="secondary small-button" disabled={pending || index === 0} onClick={() => movePin(p.recordId, -1)}>
                    {WRITE.movePinUp}
                  </button>
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending || index === pins.length - 1}
                    onClick={() => movePin(p.recordId, 1)}
                  >
                    {WRITE.movePinDown}
                  </button>
                  <button type="button" className="secondary small-button" disabled={pending} onClick={() => unpinRecord(p.recordId)}>
                    {WRITE.unpinReference}
                    <span className="sr-only"> {p.title}</span>
                  </button>
                  {linkedIds.has(p.recordId) ? (
                    <button
                      type="button"
                      className="secondary small-button"
                      disabled={pending}
                      onClick={() => run(() => unlinkReferenceAction(projectId, recordId, p.recordId))}
                    >
                      {WRITE.unlinkFromScene}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="small-button"
                      disabled={pending}
                      onClick={() => run(() => linkReferenceAction(projectId, recordId, p.recordId))}
                    >
                      {WRITE.linkToScene}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
                  {pinnedIds.has(l.recordId) ? (
                    <button type="button" className="secondary small-button" disabled={pending} onClick={() => unpinRecord(l.recordId)}>
                      {WRITE.unpinReference}
                    </button>
                  ) : (
                    <button type="button" className="secondary small-button" disabled={pending} onClick={() => pinRecord(l.recordId)}>
                      {WRITE.pinReference}
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary small-button"
                    disabled={pending}
                    onClick={() => run(() => unlinkReferenceAction(projectId, recordId, l.recordId))}
                  >
                    {WRITE.unlinkFromScene}
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
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={WRITE.searchReferenceHint} />
            </label>
            <p className="small muted" role="status">
              {hits.length
                ? WRITE.showingChoices(Math.min(hits.length, CHOICES_SHOWN), hits.length)
                : query.trim()
                  ? WRITE.showingChoices(fallbackChoices.length, fallbackChoices.length)
                  : WRITE.searchReferenceHint}
            </p>
            <p className="small muted">{WRITE.selectToPreview}</p>
            <ul className="context-list context-select-list">
              {hits.length
                ? hits.slice(0, CHOICES_SHOWN).map((hit) => {
                    const selected = preview?.ok === true && preview.id === hit.id;
                    return (
                      <li key={hit.id}>
                        <button
                          type="button"
                          className={`context-select${selected ? " selected" : ""}`}
                          aria-pressed={selected}
                          disabled={previewing === hit.id}
                          onClick={() => void open(hit.id, hit.sectionId)}
                        >
                          <span className="context-item-title" title={hit.title}>
                            {hit.title}
                          </span>
                          <span className="small muted">
                            {RECORD_TYPE_LABELS[hit.type]} · {matchLabel(hit.matchedIn)}
                            {hit.sectionTitle ? `: ${hit.sectionTitle}` : ""}
                            {linkedIds.has(hit.id) ? ` · ${WRITE.linkToScene}` : ""}
                            {pinnedIds.has(hit.id) ? ` · ${WRITE.pinReference}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })
                : fallbackChoices.map((c) => {
                    const selected = preview?.ok === true && preview.id === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={`context-select${selected ? " selected" : ""}`}
                          aria-pressed={selected}
                          disabled={previewing === c.id}
                          onClick={() => void open(c.id)}
                        >
                          <span className="context-item-title" title={c.title}>
                            {c.title}
                          </span>
                          <span className="small muted">
                            {RECORD_TYPE_LABELS[c.type]}
                            {linkedIds.has(c.id) ? ` · ${WRITE.linkToScene}` : ""}
                            {pinnedIds.has(c.id) ? ` · ${WRITE.pinReference}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby={`${idPrefix}-find-context`}>
        <h3 id={`${idPrefix}-find-context`}>{WRITE.findRelevantContext}</h3>
        <p className="small muted">{WRITE.findRelevantHint}</p>
        <p>
          <Link
            className="small-button"
            href={`/projects/${encodeURIComponent(projectId)}/assistant?seed=${encodeURIComponent(recordId)}`}
          >
            {WRITE.findRelevantContext}
          </Link>
        </p>
      </section>
      {isProtected ? <p className="small muted">{WRITE.referenceProtectedNote}</p> : null}
      <IssueList issues={issues} />
    </div>
  );
}

/** Section markers so Jump scrolls inside the rail preview. */
function PreviewBody({
  body,
  sections,
}: {
  body: string;
  sections: Array<{ id: string; title: string; level: number; start: number; end: number }>;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const s of sections) {
    if (s.start > cursor) parts.push(<span key={`t-${cursor}`}>{body.slice(cursor, s.start)}</span>);
    parts.push(
      <span key={s.id} data-section-id={s.id} className="preview-section">
        {body.slice(s.start, s.end)}
      </span>,
    );
    cursor = s.end;
  }
  if (cursor < body.length) parts.push(<span key="tail">{body.slice(cursor)}</span>);
  return <>{parts}</>;
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
