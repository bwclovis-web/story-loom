"use client";

import { useMemo, useState } from "react";
import { readAssistantJobStream } from "@/assistant/jobStream";
import { retrievalSourceHref } from "@/assistant/sourceHref";
import {
  ACTION_BOUNDARIES,
  CHARACTER_ANALYSIS_ACTIONS,
  CHARACTER_ANALYSIS_SCOPE_KINDS,
  type CharacterAnalysisAction,
  type CharacterAnalysisFinding,
  type CharacterAnalysisScopeKind,
  type CharacterAnalysisScopeSpec,
  type FindingDecisionAction,
} from "@/domain/characterAnalysis";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { Select } from "@/components/ui/Select";
import {
  applyCharacterAnalysisAction,
  previewCharacterAnalysisAction,
  requestFurtherAnalysisAction,
  saveCharacterAnalysisDecisionAction,
} from "@/app/projects/[projectId]/character-analysis/actions";
import { CHARACTER_ANALYSIS as LABELS } from "@/ui/labels";
import type { CharacterAnalysisRunView } from "@/domain/characterAnalysis";

export interface AnalysisCatalogChoice {
  id: string;
  label: string;
}

const DECISION_ACTIONS: FindingDecisionAction[] = [
  "accept",
  "edit_accept",
  "dismiss",
  "defer",
  "intentional",
  "further_analysis",
];

export function CharacterAnalysisWorkspace({
  projectId,
  characterIds,
  characters,
  chapters,
  scenes,
  books,
  assistantConfigured,
}: {
  projectId: string;
  characterIds: string[];
  characters: AnalysisCatalogChoice[];
  chapters: AnalysisCatalogChoice[];
  scenes: AnalysisCatalogChoice[];
  books: AnalysisCatalogChoice[];
  assistantConfigured: boolean;
}) {
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>(characterIds);
  const [scopeKind, setScopeKind] = useState<CharacterAnalysisScopeKind>("book");
  const [chapterId, setChapterId] = useState(chapters[0]?.id ?? "");
  const [chapterFromId, setChapterFromId] = useState(chapters[0]?.id ?? "");
  const [chapterToId, setChapterToId] = useState(chapters[chapters.length - 1]?.id ?? chapters[0]?.id ?? "");
  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? "");
  const [bookIds, setBookIds] = useState<string[]>(books.map((book) => book.id));
  const [actions, setActions] = useState<CharacterAnalysisAction[]>([...CHARACTER_ANALYSIS_ACTIONS]);
  const [preview, setPreview] = useState<Extract<Awaited<ReturnType<typeof previewCharacterAnalysisAction>>, { ok: true }>["preview"] | null>(null);
  const [run, setRun] = useState<CharacterAnalysisRunView | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | "apply" | null>(null);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [confirmProtected, setConfirmProtected] = useState(false);

  const scopeSpec: CharacterAnalysisScopeSpec = useMemo(() => {
    if (scopeKind === "scene") return { sceneRecordId: sceneId || null };
    if (scopeKind === "chapter") return { chapterRecordId: chapterId || null };
    if (scopeKind === "chapter_range") return { chapterFromId: chapterFromId || null, chapterToId: chapterToId || null };
    if (scopeKind === "multi_book") return { bookProjectIds: bookIds };
    return {};
  }, [scopeKind, sceneId, chapterId, chapterFromId, chapterToId, bookIds]);

  const toggleAction = (action: CharacterAnalysisAction) => {
    setActions((current) =>
      current.includes(action) ? current.filter((item) => item !== action) : [...CHARACTER_ANALYSIS_ACTIONS.filter((item) => current.includes(item) || item === action)],
    );
    setPreview(null);
  };

  const toggleCharacter = (id: string) => {
    setSelectedCharacters((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    setPreview(null);
  };

  const showPreview = async () => {
    setMessage("");
    if (!selectedCharacters.length || !actions.length) {
      setMessage(LABELS.needSelection);
      return;
    }
    setBusy("preview");
    const result = await previewCharacterAnalysisAction(projectId, {
      characterRecordIds: selectedCharacters,
      scopeKind,
      scopeSpec,
      actions,
    });
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setPreview(result.preview ?? null);
  };

  const startRun = async (resumeRunId?: string) => {
    setMessage("");
    setBusy("run");
    setProgress(LABELS.starting);
    try {
      const body = resumeRunId
        ? { kind: "resume" as const, runId: resumeRunId }
        : {
            kind: "start" as const,
            characterRecordIds: selectedCharacters,
            scopeKind,
            scopeSpec,
            actions,
            sourceHash: preview?.sourceHash ?? "",
          };
      if (!resumeRunId && !preview?.sourceHash) {
        setMessage(LABELS.previewFirst);
        setBusy(null);
        return;
      }
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/character-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        setMessage(payload.error?.message ?? LABELS.runFailed);
        return;
      }
      await readAssistantJobStream(response, (event) => {
        if (event.type === "started") setProgress(LABELS.running);
        if ((event as { type: string }).type === "segment_started") {
          const label = (event as { label?: string }).label;
          setProgress(label ? `${LABELS.segment}: ${label}` : LABELS.running);
        }
        if ((event as { type: string }).type === "aggregating") setProgress(LABELS.aggregating);
        if (event.type === "done" && event.result) {
          setRun(event.result as CharacterAnalysisRunView);
          setProgress(LABELS.done);
        }
        if (event.type === "error") setMessage(event.message ?? LABELS.runFailed);
      });
    } catch {
      setMessage(LABELS.runFailed);
    } finally {
      setBusy(null);
    }
  };

  const cancelRun = async () => {
    if (!run?.id && !preview) return;
    const runId = run?.id;
    if (!runId) return;
    await fetch(`/api/projects/${encodeURIComponent(projectId)}/character-analysis/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    setProgress(LABELS.cancelled);
  };

  const decide = async (findingId: string, action: FindingDecisionAction) => {
    if (!run) return;
    const result = await saveCharacterAnalysisDecisionAction(projectId, run.id, findingId, {
      action,
      editedValue: editValues[findingId] ?? "",
      reason: action === "intentional" ? LABELS.intentionalReason : "",
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (result.run) setRun(result.run);
    if (action === "further_analysis") {
      const further = await requestFurtherAnalysisAction(projectId, run.id, findingId);
      if (!further.ok) {
        setMessage(further.message);
        return;
      }
      if (further.runId) await startRun(further.runId);
    }
  };

  const applyAccepted = async () => {
    if (!run) return;
    setBusy("apply");
    const result = await applyCharacterAnalysisAction(projectId, run.id, run.contentHash, confirmProtected);
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (result.run) setRun(result.run);
    setMessage(result.message ?? LABELS.applied);
  };

  return (
    <section className="stack" aria-label={LABELS.heading}>
      <h3>
        {LABELS.heading}
        <HelpPopover label={LABELS.heading}>{LABELS.help}</HelpPopover>
      </h3>
      <p className="small muted">{LABELS.lead}</p>
      {!assistantConfigured ? <Banner tone="warn">{LABELS.notConfigured}</Banner> : null}

      {characters.length > 1 ? (
        <fieldset className="stack">
          <legend>{LABELS.characters}</legend>
          {characters.map((character) => (
            <Checkbox
              key={character.id}
              className="small"
              checked={selectedCharacters.includes(character.id)}
              onChange={() => toggleCharacter(character.id)}
              label={character.label}
            />
          ))}
        </fieldset>
      ) : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <Select
          label={LABELS.scope}
          labelPosition="top"
          size="sm"
          value={scopeKind}
          onChange={(event) => {
            setScopeKind(event.target.value as CharacterAnalysisScopeKind);
            setPreview(null);
          }}
        >
          {CHARACTER_ANALYSIS_SCOPE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {LABELS.scopes[kind]}
            </option>
          ))}
        </Select>
        {scopeKind === "scene" ? (
          <Select label={LABELS.scene} labelPosition="top" size="sm" value={sceneId} onChange={(event) => setSceneId(event.target.value)}>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.label}
              </option>
            ))}
          </Select>
        ) : null}
        {scopeKind === "chapter" ? (
          <Select label={LABELS.chapter} labelPosition="top" size="sm" value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.label}
              </option>
            ))}
          </Select>
        ) : null}
        {scopeKind === "chapter_range" ? (
          <>
            <Select label={LABELS.chapterFrom} labelPosition="top" size="sm" value={chapterFromId} onChange={(event) => setChapterFromId(event.target.value)}>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.label}
                </option>
              ))}
            </Select>
            <Select label={LABELS.chapterTo} labelPosition="top" size="sm" value={chapterToId} onChange={(event) => setChapterToId(event.target.value)}>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.label}
                </option>
              ))}
            </Select>
          </>
        ) : null}
      </div>

      {scopeKind === "multi_book" ? (
        <fieldset className="stack">
          <legend>{LABELS.books}</legend>
          {books.map((book) => (
            <Checkbox
              key={book.id}
              className="small"
              checked={bookIds.includes(book.id)}
              onChange={(event) =>
                setBookIds((current) => (event.target.checked ? [...current, book.id] : current.filter((id) => id !== book.id)))
              }
              label={book.label}
            />
          ))}
        </fieldset>
      ) : null}

      <fieldset className="stack">
        <legend>{LABELS.actions}</legend>
        {CHARACTER_ANALYSIS_ACTIONS.map((action) => (
          <Checkbox
            key={action}
            className="small"
            checked={actions.includes(action)}
            onChange={() => toggleAction(action)}
            label={`${LABELS.actionLabels[action]} — ${ACTION_BOUNDARIES[action]}`}
          />
        ))}
      </fieldset>

      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button type="button" variant="secondary" disabled={busy !== null || !assistantConfigured} onClick={() => void showPreview()}>
          {LABELS.preview}
        </Button>
        <Button
          type="button"
          disabled={busy !== null || !assistantConfigured || !preview || Boolean(preview.problem)}
          onClick={() => void startRun()}
        >
          {LABELS.start}
        </Button>
        {run && (run.status === "running" || busy === "run") ? (
          <Button type="button" variant="secondary" onClick={() => void cancelRun()}>
            {LABELS.cancel}
          </Button>
        ) : null}
        {run && (run.status === "partial" || run.status === "failed" || run.status === "cancelled") ? (
          <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void startRun(run.id)}>
            {LABELS.resume}
          </Button>
        ) : null}
      </div>

      {preview ? (
        <div className="stack">
          <p className="small">
            {LABELS.segments}: {preview.segmentCount} · {LABELS.estimatedTokens}: {preview.estimatedTotalTokens.toLocaleString("en-US")} ·{" "}
            {LABELS.monthUsage}: {preview.monthTokens.toLocaleString("en-US")} / {preview.monthlyTokenCap.toLocaleString("en-US")}
          </p>
          {preview.problem ? <Banner tone="warn">{preview.problem}</Banner> : null}
          {preview.omissions.length ? (
            <details>
              <summary>{LABELS.omissions}</summary>
              <ul>
                {preview.omissions.map((item, index) => (
                  <li key={`${item.label}-${index}`} className="small">
                    {item.label}: {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {progress ? <p className="small muted" aria-live="polite">{progress}</p> : null}
      {message ? <Banner tone={message.includes("draft") || message.includes("saved") ? "info" : "warn"}>{message}</Banner> : null}

      {run ? (
        <div className="stack">
          <p className="small">
            {LABELS.status}: {run.status}
            {run.usage
              ? ` · ${LABELS.tokens}: ${run.usage.totalTokens.toLocaleString("en-US")}${run.usage.estimated ? ` (${LABELS.estimated})` : ""}`
              : ""}
            {run.totalSegments ? ` · ${run.completedSegments}/${run.totalSegments} ${LABELS.segments}` : ""}
          </p>
          {run.errorMessage ? <Banner tone="warn">{run.errorMessage}</Banner> : null}
          {run.findings.length === 0 ? <EmptyState>{LABELS.noFindings}</EmptyState> : null}
          {run.findings.map((finding) => (
            <FindingCard
              key={finding.id}
              projectId={projectId}
              finding={finding}
              decision={run.decisions[finding.id]?.action ?? "pending"}
              editValue={editValues[finding.id] ?? finding.suggestedAction.value}
              onEdit={(value) => setEditValues((current) => ({ ...current, [finding.id]: value }))}
              onDecide={(action) => void decide(finding.id, action)}
              history={run.decisions[finding.id]?.history ?? []}
            />
          ))}
          <Checkbox
            className="small"
            checked={confirmProtected}
            onChange={(event) => setConfirmProtected(event.target.checked)}
            label={LABELS.confirmProtected}
          />
          <Button type="button" disabled={busy !== null || run.status === "applied"} onClick={() => void applyAccepted()}>
            {LABELS.applyAccepted}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function FindingCard({
  projectId,
  finding,
  decision,
  editValue,
  onEdit,
  onDecide,
  history,
}: {
  projectId: string;
  finding: CharacterAnalysisFinding;
  decision: FindingDecisionAction | "pending";
  editValue: string;
  onEdit: (value: string) => void;
  onDecide: (action: FindingDecisionAction) => void;
  history: Array<{ action: FindingDecisionAction; note: string; at: string }>;
}) {
  return (
    <article className="stack" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "0.75rem" }}>
      <p>
        <span className="badge proposed">{LABELS.canonAi}</span>{" "}
        {!finding.sourceVerified ? <span className="badge unresolved">{LABELS.unverified}</span> : null}{" "}
        {finding.uncertain ? <span className="badge">{LABELS.uncertain}</span> : null}{" "}
        {finding.planComparison ? <span className="badge manuscript">{LABELS.planLabels[finding.planComparison]}</span> : null}{" "}
        <span className="badge">{LABELS.choiceLabels[finding.deliberateChoiceAssessment]}</span>
      </p>
      <p>
        <strong>{finding.characterName}</strong> · {LABELS.actionLabels[finding.action]}
      </p>
      <p>{finding.observation}</p>
      {finding.supportingEvidence.length ? (
        <ul>
          {finding.supportingEvidence.map((item) => (
            <li key={item} className="small">
              “{item}”
            </li>
          ))}
        </ul>
      ) : null}
      <ul>
        {finding.sourceRefs.map((ref, index) => {
          const href = retrievalSourceHref(projectId, { recordId: ref.recordId });
          return (
            <li key={`${ref.recordId}-${index}`} className="small">
              {href ? <a href={href}>{ref.recordTitle || ref.recordId}</a> : ref.recordTitle || ref.recordId}
              {ref.verified ? "" : ` — ${ref.blockedReason ?? LABELS.unverified}`}
              {ref.excerpt ? ` · “${ref.excerpt.slice(0, 120)}”` : ""}
            </li>
          );
        })}
      </ul>
      <p className="small muted">
        {finding.storyLocation.storyPositionLabel ||
          [finding.storyLocation.bookLabel, finding.storyLocation.chapterTitle, finding.storyLocation.sceneTitle].filter(Boolean).join(" · ")}
      </p>
      <p className="small">{finding.reasoning}</p>
      {finding.uncertaintyNote ? <p className="small muted">{finding.uncertaintyNote}</p> : null}
      {finding.blockedReason ? <p className="small unresolved">{finding.blockedReason}</p> : null}
      <label className="small">
        {LABELS.editValue}
        <input value={editValue} onChange={(event) => onEdit(event.target.value)} />
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.35rem" }}>
        {DECISION_ACTIONS.map((action) => (
          <Button
            key={action}
            type="button"
            variant={decision === action ? "primary" : "secondary"}
            disabled={!finding.sourceVerified && (action === "accept" || action === "edit_accept")}
            onClick={() => onDecide(action)}
          >
            {LABELS.decisions[action]}
          </Button>
        ))}
      </div>
      {history.length ? (
        <details>
          <summary>{LABELS.history}</summary>
          <ul>
            {history.map((event, index) => (
              <li key={`${event.at}-${index}`} className="small">
                {LABELS.decisions[event.action]} · {new Date(event.at).toLocaleString()}
                {event.note ? ` — ${event.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
