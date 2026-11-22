"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { WriteAssistantRail } from "@/components/assistant/WriteAssistantRail";
import { StatusBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { BookOpen, FileText, Shield, Sparkles, StickyNote, Waypoints, X } from "lucide-react";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { applyTextareaEdit } from "@/components/writing/textareaEdit";
import { useLayout } from "@/components/shell/LayoutContext";
import { CONTEXT_TABS, type ContextTab } from "@/components/shell/preferences";
import { setUnsaved } from "@/components/shell/unsaved";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { Issue } from "@/domain/issues";
import { RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { DevelopmentCues } from "@/components/world/CharacterDevelopment";
import type { DevelopmentCue } from "@/domain/characterDevelopment";
import { ASSISTANT, CHARACTER_DEVELOPMENT, CONTINUITY, DRAFT, RECORD, SERIES, WEAVE, WRITE } from "@/ui/labels";
import { seriesBookLabel, seriesRecordHref } from "@/world/seriesHome";
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
  assignSceneLocationAction,
  removeSceneLocationAction,
  setSceneLocationPrimaryAction,
  type ReferencePreview,
} from "../../write/actions";
import type { ContextSearchHit } from "@/server/services/searchService";
import type { ReadingPinView } from "@/server/services/readingPinService";
import type { SceneLocationSet } from "@/server/services/sceneLocationService";

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
  assistant: ASSISTANT.tabAssistant,
  source: DRAFT.sourceTab,
  references: WRITE.references,
  notes: WRITE.notes,
  plot: WRITE.plot,
  proofread: WRITE.proofread,
};

const TAB_ICONS: Record<ContextTab, ReactNode> = {
  references: <BookOpen aria-hidden="true" size={16} strokeWidth={1.75} />,
  source: <FileText aria-hidden="true" size={16} strokeWidth={1.75} />,
  notes: <StickyNote aria-hidden="true" size={16} strokeWidth={1.75} />,
  plot: <Waypoints aria-hidden="true" size={16} strokeWidth={1.75} />,
  assistant: <Sparkles aria-hidden="true" size={16} strokeWidth={1.75} />,
  proofread: <Shield aria-hidden="true" size={16} strokeWidth={1.75} />,
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
  sceneLocations,
  choices,
  sources,
  attachableSources,
  draftScopeId,
  initialPins,
  plotBeats,
  continuityFindings = [],
  characterCues = [],
  editorText,
  editorDirty,
  editorSelection,
  draftLabel,
  assistantConfigured,
  assistantProblems,
  proofreader,
  revision,
  editable,
  onUnlock,
  textareaRef,
  onTextChange,
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
  sceneLocations: SceneLocationSet;
  choices: ChoiceItem[];
  sources: SourceItem[];
  attachableSources: AttachableSource[];
  /** Active Write draft id, or null for legacy project-level pins. */
  draftScopeId: string | null;
  initialPins: ReadingPinView[];
  plotBeats: PlotBeatItem[];
  /** Open Continuity Ledger findings that touch this chapter or scene. */
  continuityFindings?: Array<{ key: string; title: string; detail: string; href: string; severity: string }>;
  characterCues?: DevelopmentCue[];
  /** Current editor text (may be unsaved). */
  editorText: string;
  editorDirty: boolean;
  editorSelection: { start: number; end: number };
  draftLabel: string;
  assistantConfigured: boolean;
  assistantProblems: string[];
  proofreader: ReactNode;
  revision: number;
  editable: boolean;
  onUnlock: () => void;
  textareaRef: RefObject<import("@/components/writing/EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  onTextChange: (value: string) => void;
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
      className={`context-inner${tab === "assistant" ? " context-inner-assistant" : ""}`}
      onKeyDown={(e) => {
        if (overlay && e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="context-head">
        <h2 className="context-title" id={`${id}-title`}>
          {WRITE.besideManuscript}
        </h2>
        <Button type="button" variant="ghost" size="sm" icon={<X size={16} strokeWidth={1.75} />} aria-label={WRITE.closeContext} onClick={onClose}>
          {WRITE.close}
        </Button>
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
            {TAB_ICONS[t]}
            {TAB_LABELS[t]}
            {t === "source" && sources.length ? <span className="nav-count"> {sources.length}</span> : null}
            {t === "notes" && notes.length ? <span className="nav-count"> {notes.length}</span> : null}
            {t === "references" && (linked.length || continuityFindings.length) ? (
              <span className="nav-count"> {linked.length + continuityFindings.length}</span>
            ) : null}
            {t === "plot" && plotBeats.length ? <span className="nav-count"> {plotBeats.length}</span> : null}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted, so switching tabs never discards a note being written or a proofreading run. */}
      <div role="tabpanel" id={`${idPrefix}-panel-assistant`} aria-labelledby={`${idPrefix}-tab-assistant`} hidden={tab !== "assistant"} className="context-body context-body-assistant">
        <WriteAssistantRail
          projectId={projectId}
          recordId={recordId}
          recordTitle={recordTitle}
          draftScopeId={draftScopeId}
          draftLabel={draftLabel}
          editorText={editorText}
          editorDirty={editorDirty}
          editorSelection={editorSelection}
          configured={assistantConfigured}
          configProblems={assistantProblems}
          onClose={onClose}
          onOpenInclude={() => choose("references")}
        />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-source`} aria-labelledby={`${idPrefix}-tab-source`} hidden={tab !== "source"} className="context-body">
        <Sources projectId={projectId} recordId={recordId} sources={sources} attachable={attachableSources} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-references`} aria-labelledby={`${idPrefix}-tab-references`} hidden={tab !== "references"} className="context-body">
        <ContinuityStrip projectId={projectId} findings={continuityFindings} />
        {characterCues.length ? <DevelopmentCues title={CHARACTER_DEVELOPMENT.cues} cues={characterCues} /> : null}
        <References
          projectId={projectId}
          recordId={recordId}
          isProtected={isProtected}
          linked={linked}
          sceneLocations={sceneLocations}
          choices={choices}
          draftScopeId={draftScopeId}
          initialPins={initialPins}
        />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-notes`} aria-labelledby={`${idPrefix}-tab-notes`} hidden={tab !== "notes"} className="context-body">
        <Notes projectId={projectId} recordId={recordId} recordTitle={recordTitle} notes={notes} />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-plot`} aria-labelledby={`${idPrefix}-tab-plot`} hidden={tab !== "plot"} className="context-body">
        <PlotBeats
          projectId={projectId}
          recordId={recordId}
          revision={revision}
          scopeDraftId={draftScopeId ?? ""}
          beats={plotBeats}
          editable={editable}
          assistantConfigured={assistantConfigured}
          textareaRef={textareaRef}
          onUnlock={onUnlock}
          onTextChange={onTextChange}
        />
      </div>
      <div role="tabpanel" id={`${idPrefix}-panel-proofread`} aria-labelledby={`${idPrefix}-tab-proofread`} hidden={tab !== "proofread"} className="context-body">
        {proofreader}
      </div>
    </div>
  );
}

function ContinuityStrip({
  projectId,
  findings,
}: {
  projectId: string;
  findings: Array<{ key: string; title: string; detail: string; href: string; severity: string }>;
}) {
  const ledgerHref = `/projects/${encodeURIComponent(projectId)}/continuity`;
  return (
    <div className="stack" style={{ gap: "0.35rem", marginBottom: "0.75rem" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <strong className="small">{CONTINUITY.writeBadge}</strong>
        <Link className="small" href={ledgerHref}>
          {CONTINUITY.nav}
        </Link>
      </div>
      {findings.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {CONTINUITY.writeNone}
        </p>
      ) : (
        <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
          {findings.slice(0, 5).map((f) => (
            <li key={f.key}>
              <Link href={f.href}>{f.title}</Link>
              {f.detail ? <span className="muted"> — {f.detail.slice(0, 120)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        {CONTINUITY.writeBadgeHint}
      </p>
    </div>
  );
}

function PlotBeats({
  projectId,
  recordId,
  revision,
  scopeDraftId,
  beats,
  editable,
  assistantConfigured,
  textareaRef,
  onUnlock,
  onTextChange,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  scopeDraftId: string;
  beats: PlotBeatItem[];
  editable: boolean;
  assistantConfigured: boolean;
  textareaRef: RefObject<import("@/components/writing/EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  onUnlock: () => void;
  onTextChange: (value: string) => void;
}) {
  const [busyBeatId, setBusyBeatId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ beatId: string; text: string; note: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  if (!beats.length) {
    return (
      <p className="rail-empty">
        {WEAVE.writePlotEmpty}{" "}
        <Link href={`/projects/${encodeURIComponent(projectId)}/plan/weave`}>{WEAVE.writePlotOpenGrid}</Link>
      </p>
    );
  }

  async function draftBeat(beatId: string) {
    if (!editable) {
      setError(WEAVE.draftBeatProtected);
      return;
    }
    if (!assistantConfigured) {
      setError(ASSISTANT.notConfigured);
      return;
    }
    setError(null);
    setMessage("");
    setSuggestion(null);
    setBusyBeatId(beatId);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/projects/${projectId}/beat-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId, revision, beatId, scopeDraftId }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(json?.error?.message ?? `Request failed (${response.status}).`);
        setBusyBeatId(null);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let lineEnd = buffer.indexOf("\n");
        while (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 1);
          if (!line.trim()) {
            lineEnd = buffer.indexOf("\n");
            continue;
          }
          const event = JSON.parse(line) as {
            type: string;
            result?: { suggestion?: string | null; note?: string | null; errorMessage?: string | null; status?: string };
            message?: string;
          };
          if (event.type === "done" && event.result) {
            if (event.result.suggestion) {
              setSuggestion({ beatId, text: event.result.suggestion, note: event.result.note ?? null });
            } else {
              setError(event.result.errorMessage ?? WEAVE.draftBeatEmpty);
            }
          }
          if (event.type === "error") setError(event.message ?? "The request failed.");
          lineEnd = buffer.indexOf("\n");
        }
      }
    } catch {
      if (!controller.signal.aborted) setError("Could not reach the app server.");
    } finally {
      setBusyBeatId(null);
    }
  }

  function acceptSuggestion() {
    if (!suggestion) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const insert = suggestion.text;
    const prefix = start > 0 && ta.value[start - 1] !== "\n" ? "\n\n" : "";
    applyTextareaEdit(ta, { start, end, text: `${prefix}${insert}` });
    onTextChange(ta.value);
    setSuggestion(null);
    setMessage(WEAVE.draftBeatAccepted);
  }

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {WEAVE.draftBeatHint}
      </p>
      {!editable ? (
        <p className="small muted">
          {WEAVE.draftBeatProtected}{" "}
          <Button type="button" size="sm" variant="secondary" onClick={onUnlock}>
            Enable editing
          </Button>
        </p>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <p className="small muted">{message}</p> : null}
      {suggestion ? (
        <div className="stack panel">
          <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {suggestion.text}
          </pre>
          {suggestion.note ? <p className="small muted">{suggestion.note}</p> : null}
          <div className="row" style={{ gap: "0.5rem" }}>
            <Button type="button" size="sm" disabled={!editable} onClick={acceptSuggestion}>
              {WEAVE.draftBeatAccept}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setSuggestion(null)}>
              {WEAVE.draftBeatDismiss}
            </Button>
          </div>
        </div>
      ) : null}
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
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(beat.gridId)}`}
                className="small"
              >
                {beat.gridTitle} — {WEAVE.writePlotOpenGrid}
              </Link>
              {assistantConfigured ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!editable || busyBeatId !== null}
                  onClick={() => void draftBeat(beat.id)}
                >
                  {busyBeatId === beat.id ? WEAVE.draftBeatRunning : WEAVE.draftBeat}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
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
                <Button type="button" disabled={pending} onClick={() => open(s)} variant="secondary" size="sm">
                  {DRAFT.openSourcePreview}
                </Button>
                <Button
                  type="button"
                 
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      await detachRewriteSourceAction(projectId, recordId, s.toRecordId);
                      setPreview((p) => (p?.toRecordId === s.toRecordId ? null : p));
                      router.refresh();
                    });
                  }}
                 variant="secondary" size="sm">
                  {DRAFT.detachSource}
                </Button>
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
            <Button type="button" onClick={() => setPreview(null)} variant="secondary" size="sm">
              {DRAFT.closeSourcePreview}
            </Button>
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
                <Button
                  type="button"
                 
                  disabled={pending}
                  onClick={() => {
                    startTransition(async () => {
                      await attachRewriteSourceAction(projectId, recordId, a.id);
                      router.refresh();
                    });
                  }}
                 variant="secondary" size="sm">
                  {DRAFT.attachSource}
                </Button>
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

function SceneLocationAssign({
  projectId,
  recordId,
  initial,
  choices,
}: {
  projectId: string;
  recordId: string;
  initial: SceneLocationSet;
  choices: ChoiceItem[];
}) {
  const idPrefix = useId();
  const [assigned, setAssigned] = useState(initial);
  const [choice, setChoice] = useState("");
  const [primary, setPrimary] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setAssigned(initial);
  }, [initial]);

  const taken = useMemo(() => new Set(assigned.locations.map((location) => location.locationRecordId)), [assigned.locations]);
  const available = choices.filter((item) => !taken.has(item.id));

  const apply = (result: { ok: true; set: SceneLocationSet } | { ok: false; issues: Issue[] }) => {
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    setAssigned(result.set);
  };

  return (
    <section className="stack" aria-labelledby={`${idPrefix}-locations`}>
      <h3 id={`${idPrefix}-locations`}>{WRITE.sceneLocations}</h3>
      <p className="small muted">{WRITE.sceneLocationsNote}</p>
      <IssueList issues={issues} />
      {assigned.locations.length === 0 ? (
        <p className="small muted">{WRITE.noSceneLocations}</p>
      ) : (
        <ul className="context-list">
          {assigned.locations.map((location) => (
            <li key={location.id}>
              <span className="context-item-title" title={location.title}>
                {location.title}
              </span>
              <span className="small muted">
                {RECORD_TYPE_LABELS[location.type]}
                {location.isPrimary ? ` · ${WRITE.primaryLocation}` : ""}
                {location.unavailable ? ` · ${WRITE.locationUnavailable}` : ""}
              </span>
              <div className="row">
                <ButtonLink href={`/projects/${projectId}/records/${location.locationRecordId}`} variant="secondary" size="sm">
                  {WRITE.openReference}
                  <span className="sr-only"> {location.title}</span>
                </ButtonLink>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      apply(
                        await setSceneLocationPrimaryAction(projectId, recordId, location.id, {
                          isPrimary: !location.isPrimary,
                          expectedFingerprint: assigned.fingerprint,
                        }),
                      );
                    })
                  }
                >
                  {location.isPrimary ? WRITE.clearPrimary : WRITE.makePrimary}
                  <span className="sr-only"> {location.title}</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      apply(
                        await removeSceneLocationAction(projectId, recordId, location.id, assigned.fingerprint),
                      );
                    })
                  }
                >
                  {WRITE.removeLocation}
                  <span className="sr-only"> {location.title}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!choice) return;
          startTransition(async () => {
            const result = await assignSceneLocationAction(projectId, recordId, choice, {
              isPrimary: primary,
              expectedFingerprint: assigned.fingerprint,
            });
            apply(result);
            if (result.ok) {
              setChoice("");
              setPrimary(false);
            }
          });
        }}
      >
        <label>
          {WRITE.assignLocation}
          <select value={choice} onChange={(event) => setChoice(event.target.value)} disabled={pending || available.length === 0}>
            <option value="">{WRITE.chooseLocation}</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <Checkbox
          className="scene-location-check"
          checked={primary}
          onChange={(event) => setPrimary(event.target.checked)}
          disabled={pending}
          label={WRITE.primaryLocation}
        />
        <Button type="submit" size="sm" disabled={pending || !choice}>
          {WRITE.assignLocation}
        </Button>
      </form>
    </section>
  );
}

function References({
  projectId,
  recordId,
  isProtected,
  linked,
  sceneLocations,
  choices,
  draftScopeId,
  initialPins,
}: {
  projectId: string;
  recordId: string;
  isProtected: boolean;
  linked: LinkedItem[];
  sceneLocations: SceneLocationSet;
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
      <SceneLocationAssign projectId={projectId} recordId={recordId} initial={sceneLocations} choices={choices} />
      {preview ? (
        <section className="reference-preview" ref={previewRef} tabIndex={-1} aria-labelledby={`${idPrefix}-preview`}>
          {preview.ok ? (
            <>
              <h3 id={`${idPrefix}-preview`}>{preview.title}</h3>
              <p className="row small muted">
                {preview.typeLabel} <StatusBadge status={preview.authorityStatus} /> revision {preview.revision}
                {preview.seriesHome ? ` · ${SERIES.homeBadge(seriesBookLabel(preview.seriesHome))}` : ""}
              </p>
              {preview.seriesHome ? <p className="small">{SERIES.contextNote}</p> : null}
              <div className="row reference-preview-actions">
                {preview.seriesHome ? (
                  <Link href={seriesRecordHref(preview.seriesHome.projectId, preview.id)}>{SERIES.editIn(seriesBookLabel(preview.seriesHome))}</Link>
                ) : pinnedIds.has(preview.id) ? (
                  <Button type="button" disabled={pending} onClick={() => unpinRecord(preview.id)} variant="secondary" size="sm">
                    {WRITE.unpinReference}
                  </Button>
                ) : (
                  <Button type="button" disabled={pending} onClick={() => pinRecord(preview.id)} size="sm">
                    {WRITE.pinReference}
                  </Button>
                )}
                {!preview.seriesHome && linkedIds.has(preview.id) ? (
                  <Button
                    type="button"
                   
                    disabled={pending}
                    onClick={() => run(() => unlinkReferenceAction(projectId, recordId, preview.id))}
                   variant="secondary" size="sm">
                    {WRITE.unlinkFromScene}
                  </Button>
                ) : preview.seriesHome ? null : (
                  <Button
                    type="button"
                   
                    disabled={pending}
                    onClick={() => run(() => linkReferenceAction(projectId, recordId, preview.id))}
                   size="sm">
                    {WRITE.linkToScene}
                  </Button>
                )}
                <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(preview.id)}`} className="small">
                  {WRITE.openFull}
                </Link>
                <Button type="button" onClick={() => setPreview(null)} variant="secondary" size="sm">
                  {WRITE.closeReference}
                </Button>
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
              <Button type="button" onClick={() => setPreview(null)} variant="secondary" size="sm">
                {WRITE.closeReference}
              </Button>
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
                  <Button type="button" onClick={() => void open(p.recordId)} disabled={previewing === p.recordId} variant="secondary" size="sm">
                    {WRITE.openReference}
                    <span className="sr-only"> {p.title}</span>
                  </Button>
                  <Button type="button" disabled={pending || index === 0} onClick={() => movePin(p.recordId, -1)} variant="secondary" size="sm">
                    {WRITE.movePinUp}
                  </Button>
                  <Button
                    type="button"
                   
                    disabled={pending || index === pins.length - 1}
                    onClick={() => movePin(p.recordId, 1)}
                   variant="secondary" size="sm">
                    {WRITE.movePinDown}
                  </Button>
                  <Button type="button" disabled={pending} onClick={() => unpinRecord(p.recordId)} variant="secondary" size="sm">
                    {WRITE.unpinReference}
                    <span className="sr-only"> {p.title}</span>
                  </Button>
                  {linkedIds.has(p.recordId) ? (
                    <Button
                      type="button"
                     
                      disabled={pending}
                      onClick={() => run(() => unlinkReferenceAction(projectId, recordId, p.recordId))}
                     variant="secondary" size="sm">
                      {WRITE.unlinkFromScene}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                     
                      disabled={pending}
                      onClick={() => run(() => linkReferenceAction(projectId, recordId, p.recordId))}
                     size="sm">
                      {WRITE.linkToScene}
                    </Button>
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
                  <Button type="button" onClick={() => void open(l.recordId)} disabled={previewing === l.recordId} variant="secondary" size="sm">
                    {WRITE.openReference}
                    <span className="sr-only"> {l.title}</span>
                  </Button>
                  {pinnedIds.has(l.recordId) ? (
                    <Button type="button" disabled={pending} onClick={() => unpinRecord(l.recordId)} variant="secondary" size="sm">
                      {WRITE.unpinReference}
                    </Button>
                  ) : (
                    <Button type="button" disabled={pending} onClick={() => pinRecord(l.recordId)} variant="secondary" size="sm">
                      {WRITE.pinReference}
                    </Button>
                  )}
                  <Button
                    type="button"
                   
                    disabled={pending}
                    onClick={() => run(() => unlinkReferenceAction(projectId, recordId, l.recordId))}
                   variant="secondary" size="sm">
                    {WRITE.unlinkFromScene}
                    <span className="sr-only"> {l.title}</span>
                  </Button>
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
                            {hit.seriesHome ? ` · ${SERIES.homeBadge(seriesBookLabel(hit.seriesHome))}` : ""}
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
          <ButtonLink
           
            href={`/projects/${encodeURIComponent(projectId)}/assistant?seed=${encodeURIComponent(recordId)}`}
           size="sm">
            {WRITE.findRelevantContext}
          </ButtonLink>
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
                    <Button type="button" onClick={() => setEditing(n.id)} variant="secondary" size="sm">
                      {WRITE.editNote}
                      <span className="sr-only"> {n.title}</span>
                    </Button>
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
        <Checkbox name="unlockProtected" label={RECORD.unlockProtected} />
      ) : null}
      {!state.ok ? <IssueList issues={state.issues ?? []} /> : null}
      {!state.ok && state.message ? <p className="error-text small">{state.message}</p> : null}
      <div className="row">
        <Button type="submit" disabled={pending} size="sm">
          {pending ? WRITE.saving : WRITE.saveNote}
        </Button>
        <Button type="button" onClick={onDone} variant="secondary" size="sm">
          {WRITE.closeNote}
        </Button>
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
        <Button type="submit" disabled={pending} size="sm">
          {pending ? WRITE.saving : WRITE.addNote}
        </Button>
      </div>
    </form>
  );
}

