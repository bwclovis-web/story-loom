"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ContextSection } from "@/components/ContextSection";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import {
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  type EstablishedFactView,
  type EvidenceKind,
  type CharacterKnowledgeCheckResult,
} from "@/server/services/establishedFactService";
import { WORLD } from "@/ui/labels";
import {
  acceptFactAction,
  addFactEvidenceAction,
  clearFactRecheckAction,
  dismissFactAction,
  extractFactsAction,
  removeFactEvidenceAction,
  runCharacterKnowledgeCheckAction,
} from "./establishedActions";

export interface EvidenceSourceChoice {
  id: string;
  title: string;
  typeLabel: string;
  bodyLength: number;
}

export interface DraftChoice {
  id: string;
  label: string;
  kind: string;
}

export interface SceneChoice {
  id: string;
  title: string;
  draftId: string | null;
  typeLabel: string;
}

export function EstablishedInRail({
  projectId,
  subjectRecordId,
  recordType,
  initialFacts,
  evidenceSources,
  drafts,
  scenes,
}: {
  projectId: string;
  subjectRecordId: string;
  recordType: string;
  initialFacts: EstablishedFactView[];
  evidenceSources: EvidenceSourceChoice[];
  drafts: DraftChoice[];
  scenes: SceneChoice[];
}) {
  const router = useRouter();
  const [facts, setFacts] = useState(initialFacts);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [extractKind, setExtractKind] = useState<EvidenceKind>("zero_draft");
  const [evidenceDraft, setEvidenceDraft] = useState<Record<string, { sourceId: string; start: string; end: string }>>({});
  const [draftId, setDraftId] = useState(drafts[0]?.id ?? "");
  const [sceneId, setSceneId] = useState("");
  const [check, setCheck] = useState<CharacterKnowledgeCheckResult | null>(null);
  const base = `/projects/${encodeURIComponent(projectId)}/records`;

  const pendingFacts = useMemo(() => facts.filter((f) => f.status === "pending"), [facts]);
  const acceptedFacts = useMemo(() => facts.filter((f) => f.status === "accepted"), [facts]);
  const sceneChoices = useMemo(
    () => scenes.filter((s) => !draftId || !s.draftId || s.draftId === draftId),
    [scenes, draftId],
  );

  const refreshFacts = (next: EstablishedFactView[]) => {
    setFacts(next);
    setIssues([]);
    router.refresh();
  };

  const upsertFact = (fact: EstablishedFactView) => {
    setFacts((list) => {
      const without = list.filter((f) => f.id !== fact.id);
      return fact.status === "dismissed" ? without : [...without, fact].sort((a, b) => a.status.localeCompare(b.status));
    });
    setIssues([]);
    router.refresh();
  };

  return (
    <>
      <ContextSection title={WORLD.establishedIn} count={acceptedFacts.length + pendingFacts.length} className="established-in-section">
        <p className="small muted">{WORLD.establishedInNote}</p>
        <IssueList issues={issues} />

        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <label className="small">
            Evidence stream
            <select value={extractKind} onChange={(e) => setExtractKind(e.target.value as EvidenceKind)} disabled={pending}>
              {EVIDENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVIDENCE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="small-button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await extractFactsAction(projectId, subjectRecordId, extractKind);
                if (!result.ok) {
                  setIssues(result.issues);
                  return;
                }
                refreshFacts(result.facts);
              })
            }
          >
            {pending ? WORLD.extractingFacts : WORLD.extractFacts}
          </button>
        </div>

        {pendingFacts.length ? (
          <div className="stack" style={{ marginTop: "0.75rem" }}>
            <h3 className="small">{WORLD.pendingFacts}</h3>
            <ul className="context-links">
              {pendingFacts.map((f) => (
                <li key={f.id}>
                  <div>{f.statement}</div>
                  <div className="small muted">{f.evidenceKindLabel}</div>
                  <div className="row" style={{ gap: "0.35rem", marginTop: "0.25rem" }}>
                    <button
                      type="button"
                      className="small-button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await acceptFactAction(projectId, f.id, subjectRecordId);
                          if (!result.ok) setIssues(result.issues);
                          else upsertFact(result.fact);
                        })
                      }
                    >
                      {WORLD.acceptFact}
                    </button>
                    <button
                      type="button"
                      className="secondary small-button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await dismissFactAction(projectId, f.id, subjectRecordId);
                          if (!result.ok) setIssues(result.issues);
                          else upsertFact(result.fact);
                        })
                      }
                    >
                      {WORLD.dismissFact}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {acceptedFacts.length ? (
          <div className="stack" style={{ marginTop: "0.75rem" }}>
            <h3 className="small">{WORLD.acceptedFacts}</h3>
            <ul className="context-links">
              {acceptedFacts.map((f) => {
                const draft = evidenceDraft[f.id] ?? { sourceId: "", start: "0", end: "0" };
                return (
                  <li key={f.id}>
                    <div>{f.statement}</div>
                    <div className="small muted">{f.evidenceKindLabel}</div>
                    <div className="small" style={{ marginTop: "0.35rem" }}>
                      <strong>{WORLD.factEvidence}</strong>
                    </div>
                    {f.evidence.length ? (
                      <ul className="context-links">
                        {f.evidence.map((e) => (
                          <li key={e.id}>
                            <Link href={`${base}/${encodeURIComponent(e.sourceRecordId)}`}>{e.sourceTitle}</Link>
                            <span className="small muted">
                              {" "}
                              (rev {e.revisionNumber}, {e.evidenceKindLabel})
                            </span>
                            {e.needsRecheck ? <div className="small warning-text">{WORLD.needsRecheck}</div> : null}
                            <blockquote className="small" style={{ margin: "0.25rem 0" }}>
                              {e.passageExcerpt}
                            </blockquote>
                            <div className="row" style={{ gap: "0.35rem" }}>
                              {e.needsRecheck ? (
                                <button
                                  type="button"
                                  className="small-button"
                                  disabled={pending}
                                  onClick={() =>
                                    startTransition(async () => {
                                      const result = await clearFactRecheckAction(projectId, e.id, subjectRecordId);
                                      if (!result.ok) setIssues(result.issues);
                                      else {
                                        setFacts((list) =>
                                          list.map((fact) =>
                                            fact.id !== f.id
                                              ? fact
                                              : {
                                                  ...fact,
                                                  evidence: fact.evidence.map((ev) =>
                                                    ev.id === e.id ? { ...ev, needsRecheck: false } : ev,
                                                  ),
                                                },
                                          ),
                                        );
                                        setIssues([]);
                                        router.refresh();
                                      }
                                    })
                                  }
                                >
                                  {WORLD.clearRecheck}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="secondary small-button"
                                disabled={pending}
                                onClick={() =>
                                  startTransition(async () => {
                                    const result = await removeFactEvidenceAction(projectId, e.id, subjectRecordId);
                                    if (!result.ok) setIssues(result.issues);
                                    else {
                                      setFacts((list) =>
                                        list.map((fact) =>
                                          fact.id !== f.id
                                            ? fact
                                            : { ...fact, evidence: fact.evidence.filter((ev) => ev.id !== e.id) },
                                        ),
                                      );
                                      setIssues([]);
                                      router.refresh();
                                    }
                                  })
                                }
                              >
                                {WORLD.removeFactEvidence}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small muted">{WORLD.noFactEvidence}</p>
                    )}
                    <div className="stack" style={{ marginTop: "0.35rem" }}>
                      <label className="small">
                        {WORLD.chooseEvidenceSource}
                        <select
                          value={draft.sourceId}
                          onChange={(e) =>
                            setEvidenceDraft((m) => ({
                              ...m,
                              [f.id]: { ...draft, sourceId: e.target.value },
                            }))
                          }
                          disabled={pending}
                        >
                          <option value="">{WORLD.chooseEvidenceSource}</option>
                          {evidenceSources.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title} ({s.typeLabel}, {s.bodyLength} chars)
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="row" style={{ gap: "0.5rem" }}>
                        <label className="small">
                          {WORLD.passageStart}
                          <input
                            type="number"
                            min={0}
                            value={draft.start}
                            onChange={(e) =>
                              setEvidenceDraft((m) => ({ ...m, [f.id]: { ...draft, start: e.target.value } }))
                            }
                            disabled={pending}
                          />
                        </label>
                        <label className="small">
                          {WORLD.passageEnd}
                          <input
                            type="number"
                            min={0}
                            value={draft.end}
                            onChange={(e) =>
                              setEvidenceDraft((m) => ({ ...m, [f.id]: { ...draft, end: e.target.value } }))
                            }
                            disabled={pending}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="small-button"
                        disabled={pending || !draft.sourceId}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await addFactEvidenceAction(projectId, f.id, subjectRecordId, {
                              sourceRecordId: draft.sourceId,
                              passageStart: Number(draft.start) || 0,
                              passageEnd: Number(draft.end) || 0,
                            });
                            if (!result.ok) setIssues(result.issues);
                            else upsertFact(result.fact);
                          })
                        }
                      >
                        {WORLD.addFactEvidence}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : !pendingFacts.length ? (
          <p className="small muted" style={{ marginTop: "0.5rem" }}>
            {WORLD.noEstablishedFacts}
          </p>
        ) : null}
      </ContextSection>

      {recordType === "character_dossier" ? (
        <ContextSection title={WORLD.characterKnowledgeCheck} className="knowledge-check-section">
          <p className="small muted">{WORLD.characterKnowledgeNote}</p>
          <div className="stack">
            <label className="small">
              {WORLD.chooseDraft}
              <select
                value={draftId}
                onChange={(e) => {
                  setDraftId(e.target.value);
                  setSceneId("");
                  setCheck(null);
                }}
                disabled={pending || drafts.length === 0}
              >
                {drafts.length === 0 ? <option value="">No drafts yet</option> : null}
                {drafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.kind === "author_manuscript" ? "author rewrite" : "zero draft"})
                  </option>
                ))}
              </select>
            </label>
            <label className="small">
              {WORLD.chooseScene}
              <select value={sceneId} onChange={(e) => setSceneId(e.target.value)} disabled={pending}>
                <option value="">{WORLD.chooseScene}</option>
                {sceneChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.typeLabel})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="small-button"
              disabled={pending || !sceneId}
              onClick={() =>
                startTransition(async () => {
                  const result = await runCharacterKnowledgeCheckAction(projectId, {
                    subjectRecordId,
                    sceneId,
                    draftId: draftId || null,
                  });
                  if (!result.ok) {
                    setIssues(result.issues);
                    setCheck(null);
                    return;
                  }
                  setIssues([]);
                  setCheck(result.result);
                })
              }
            >
              {WORLD.runKnowledgeCheck}
            </button>
          </div>

          {check ? (
            <div className="stack" style={{ marginTop: "0.75rem" }}>
              <p className="small muted">
                {check.draftLabel ? `${check.draftLabel} · ` : ""}
                {check.sceneTitle} · {EVIDENCE_KIND_LABELS[check.evidenceKind]}
              </p>
              <h3 className="small">{WORLD.passagesChecked}</h3>
              {check.passagesChecked.length ? (
                <ul className="context-links">
                  {check.passagesChecked.map((p, i) => (
                    <li key={`${p.start}-${i}`}>
                      <span className="small muted">{p.matchedName}</span>
                      <blockquote className="small" style={{ margin: "0.25rem 0" }}>
                        {p.excerpt}
                      </blockquote>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">{WORLD.noPassagesFound}</p>
              )}
              <h3 className="small">{WORLD.coveredFacts}</h3>
              <p className="small muted">
                {check.coveredFactIds.length} of {check.coveredFactIds.length + check.gaps.length} accepted fact
                {check.coveredFactIds.length + check.gaps.length === 1 ? "" : "s"}
              </p>
              <h3 className="small">{WORLD.knowledgeGaps}</h3>
              {check.gaps.length ? (
                <ul className="context-links">
                  {check.gaps.map((g) => (
                    <li key={g.factId}>
                      {g.statement}
                      <div className="small muted">{EVIDENCE_KIND_LABELS[g.evidenceKind]}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">{WORLD.noKnowledgeGaps}</p>
              )}
            </div>
          ) : null}
        </ContextSection>
      ) : null}
    </>
  );
}
