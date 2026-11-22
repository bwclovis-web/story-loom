"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import type { Issue } from "@/domain/issues";
import { errorIssue } from "@/domain/issues";
import type { WeaveBuildDecisions, WeaveBuildRunView } from "@/server/services/weaveBuildFromDraftService";
import { WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS, type WeaveViewKind } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { applyWeaveBuildAction, saveWeaveBuildDecisionsAction } from "./actions";

export interface DraftChoice {
  id: string;
  label: string;
  kind: string;
}

export interface ChapterChoice {
  id: string;
  title: string;
  draftId: string | null;
}

export interface GridChoice {
  id: string;
  title: string;
  viewKind: string;
}

export interface RewritePinChoice {
  fromRecordId: string;
  fromTitle: string;
  toRecordId: string;
  toRevisionNumber: number;
  toTitle: string;
}

export function BuildGridFromDraftForm({
  projectId,
  drafts,
  chapters,
  grids,
  rewritePins,
  assistantConfigured,
  initialRun,
}: {
  projectId: string;
  drafts: DraftChoice[];
  chapters: ChapterChoice[];
  grids: GridChoice[];
  rewritePins: RewritePinChoice[];
  assistantConfigured: boolean;
  initialRun: WeaveBuildRunView | null;
}) {
  const router = useRouter();
  const [draftId, setDraftId] = useState<string>(
    () => drafts.find((d) => d.kind === "zero_draft")?.id ?? drafts[0]?.id ?? "",
  );
  const [viewKind, setViewKind] = useState<WeaveViewKind>("zero_draft_map");
  const [destMode, setDestMode] = useState<"new" | "existing">(grids[0] ? "existing" : "new");
  const [gridId, setGridId] = useState(grids[0]?.id ?? "");
  const [gridTitle, setGridTitle] = useState("");
  const [chapterFromId, setChapterFromId] = useState("");
  const [chapterToId, setChapterToId] = useState("");
  const [usePins, setUsePins] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<WeaveBuildRunView | null>(initialRun);

  const chapterOptions = useMemo(
    () => chapters.filter((c) => (draftId ? c.draftId === draftId : c.draftId == null)),
    [chapters, draftId],
  );

  const analyze = async () => {
    setIssues([]);
    if (!assistantConfigured) {
      setIssues([errorIssue("INVALID_CHANGE", WEAVE.buildAssistantRequired)]);
      return;
    }
    setBusy(true);
    try {
      const pins = usePins
        ? rewritePins.map((p) => ({ toRecordId: p.toRecordId, toRevisionNumber: p.toRevisionNumber }))
        : undefined;
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/weave/build-from-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draftId || null,
          gridId: destMode === "existing" ? gridId || null : null,
          gridTitle,
          viewKind,
          chapterFromId: chapterFromId || null,
          chapterToId: chapterToId || null,
          rewritePins: pins,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { code?: string; message?: string };
        } | null;
        const message = data?.error?.message ?? `Request failed (${res.status}).`;
        setIssues([errorIssue("INVALID_CHANGE", message)]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setIssues([errorIssue("INVALID_CHANGE", "No response body.")]);
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; result?: WeaveBuildRunView; message?: string };
          if (event.type === "done" && event.result) {
            setRun(event.result);
            router.replace(
              `/projects/${encodeURIComponent(projectId)}/plan/weave/build/${encodeURIComponent(event.result.id)}`,
            );
          }
          if (event.type === "error") {
            setIssues([errorIssue("INVALID_CHANGE", event.message ?? "Build failed.")]);
          }
        }
      }
    } catch (e) {
      setIssues([errorIssue("INVALID_CHANGE", e instanceof Error ? e.message : "Build failed.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      {!assistantConfigured ? <p className="muted">{WEAVE.buildAssistantRequired}</p> : null}
      <p className="small muted">{WEAVE.buildFromDraftLead}</p>
      <form
        className="stack"
        style={{ gap: "0.75rem" }}
        onSubmit={(e) => {
          e.preventDefault();
          void analyze();
        }}
      >
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
          <label>
            {WEAVE.buildDraft}
            <select value={draftId} onChange={(e) => setDraftId(e.target.value)} disabled={!drafts.length}>
              {!drafts.length ? <option value="">Legacy manuscript</option> : null}
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WEAVE.viewKind}
            <select value={viewKind} onChange={(e) => setViewKind(e.target.value as WeaveViewKind)}>
              {WEAVE_VIEW_KINDS.map((k) => (
                <option key={k} value={k}>
                  {WEAVE_VIEW_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WEAVE.buildChapterFrom}
            <select value={chapterFromId} onChange={(e) => setChapterFromId(e.target.value)}>
              <option value="">First</option>
              {chapterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WEAVE.buildChapterTo}
            <select value={chapterToId} onChange={(e) => setChapterToId(e.target.value)}>
              <option value="">Last</option>
              {chapterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "end" }}>
          <label>
            {WEAVE.buildDestination}
            <select value={destMode} onChange={(e) => setDestMode(e.target.value as "new" | "existing")}>
              <option value="new">{WEAVE.buildNewGrid}</option>
              <option value="existing" disabled={!grids.length}>
                {WEAVE.buildExistingGrid}
              </option>
            </select>
          </label>
          {destMode === "existing" ? (
            <label>
              {WEAVE.openGrid}
              <select value={gridId} onChange={(e) => setGridId(e.target.value)}>
                {grids.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              {WEAVE.buildGridTitle}
              <input value={gridTitle} onChange={(e) => setGridTitle(e.target.value)} maxLength={200} placeholder={WEAVE_VIEW_LABELS[viewKind]} />
            </label>
          )}
        </div>
        {rewritePins.length ? (
          <Checkbox checked={usePins} onChange={(e) => setUsePins(e.target.checked)} label={WEAVE.buildUsePinnedSources} />
        ) : null}
        <div className="row" style={{ gap: "0.5rem" }}>
          <Button type="submit" disabled={busy || !assistantConfigured}>
            {busy ? WEAVE.buildAnalyzing : WEAVE.buildAnalyze}
          </Button>
        </div>
        <IssueList issues={issues} />
      </form>
      {run ? <BuildGridReview projectId={projectId} initial={run} /> : null}
    </div>
  );
}

export function BuildGridReview({ projectId, initial }: { projectId: string; initial: WeaveBuildRunView }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [decisions, setDecisions] = useState<WeaveBuildDecisions>(initial.decisions);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const proposal = run.proposal;

  const setDecision = (key: string, patch: WeaveBuildDecisions[string]) => {
    setDecisions((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const acceptAll = (keys: string[]) => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = { ...next[key], decision: "accept" };
      return next;
    });
  };

  const skipAll = (keys: string[]) => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = { ...next[key], decision: "skip" };
      return next;
    });
  };

  if (!proposal) {
    return (
      <section className="panel">
        <h2>{WEAVE.buildPreview}</h2>
        <p className="muted">{run.errorMessage ?? run.status}</p>
      </section>
    );
  }

  const threadKeys = proposal.threads.map((t) => t.key);
  const rowKeys = proposal.rows.map((r) => r.key);
  const beatKeys = proposal.beats.map((b) => b.key);
  const existingThreads = run.existingGrid?.threads ?? [];
  const existingBeats = run.existingGrid?.beats ?? [];

  return (
    <div className="weave-build-review">
      <section className="panel">
        <h2>{WEAVE.buildPreview}</h2>
        <p>{proposal.summary}</p>
        <p className="small muted">
          {run.status}
          {run.contentHash ? ` · ${run.contentHash.slice(0, 8)}` : ""}
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <Button
            type="button"
           
            onClick={() => acceptAll([...threadKeys, ...rowKeys, ...beatKeys])}
           variant="secondary" size="sm">
            {WEAVE.buildSelectAllAccept}
          </Button>
          <Button
            type="button"
           
            onClick={() => skipAll([...threadKeys, ...rowKeys, ...beatKeys])}
           variant="secondary" size="sm">
            {WEAVE.buildSelectAllSkip}
          </Button>
          <Button
            type="button"
           
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setIssues([]);
                const saved = await saveWeaveBuildDecisionsAction(projectId, run.id, run.contentHash, decisions);
                if (!saved.ok) {
                  setIssues(saved.issues);
                  return;
                }
                setRun(saved.run);
                const applied = await applyWeaveBuildAction(projectId, run.id, run.contentHash);
                if (!applied.ok) {
                  setIssues(applied.issues);
                  return;
                }
                router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(applied.result.gridId)}`);
                router.refresh();
              })
            }
           size="sm">
            {WEAVE.buildApplyAccepted}
          </Button>
        </div>
        <IssueList issues={issues} />
      </section>

      <div className="weave-build-columns">
        <section className="panel">
          <h3>{WEAVE.buildThreadsHeading}</h3>
          <ul className="stack">
            {proposal.threads.map((thread) => {
              const d = decisions[thread.key]?.decision ?? "pending";
              return (
                <li key={thread.key} className="weave-build-card">
                  <strong>{thread.title}</strong>
                  <DecisionRow
                    value={d}
                    onChange={(decision) => setDecision(thread.key, { decision })}
                  />
                  {existingThreads.length ? (
                    <label className="small">
                      {WEAVE.buildMatchThread}
                      <select
                        value={decisions[thread.key]?.matchThreadId ?? ""}
                        onChange={(e) =>
                          setDecision(thread.key, {
                            decision: decisions[thread.key]?.decision ?? "accept",
                            matchThreadId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{WEAVE.buildNoMatch}</option>
                        {existingThreads.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <h3>{WEAVE.buildRowsHeading}</h3>
          <ul className="stack">
            {proposal.rows.map((row) => {
              const d = decisions[row.key]?.decision ?? "pending";
              return (
                <li key={row.key} className="weave-build-card">
                  <strong>{row.summary || row.manuscriptRecordId}</strong>
                  <p className="small muted">{row.manuscriptRecordId}</p>
                  {(row.purposeGoal || row.purposeChange || row.purposeForward) && (
                    <ul className="small">
                      {row.purposeGoal ? (
                        <li>
                          {WEAVE.buildPurposeGoal}: {row.purposeGoal}
                        </li>
                      ) : null}
                      {row.purposeChange ? (
                        <li>
                          {WEAVE.buildPurposeChange}: {row.purposeChange}
                        </li>
                      ) : null}
                      {row.purposeForward ? (
                        <li>
                          {WEAVE.buildPurposeForward}: {row.purposeForward}
                        </li>
                      ) : null}
                    </ul>
                  )}
                  {row.proposedBoundaries.length ? (
                    <div className="small">
                      <p>{WEAVE.buildProposedBoundaries}</p>
                      <ul>
                        {row.proposedBoundaries.map((b) => (
                          <li key={b.key}>
                            <strong>{b.title}</strong>
                            <blockquote className="weave-build-excerpt">{b.excerpt}</blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <DecisionRow value={d} onChange={(decision) => setDecision(row.key, { decision })} />
                </li>
              );
            })}
          </ul>

          <h3>{WEAVE.buildBeatsHeading}</h3>
          <ul className="stack">
            {proposal.beats.map((beat) => {
              const d = decisions[beat.key]?.decision ?? "pending";
              return (
                <li key={beat.key} className="weave-build-card">
                  <strong>{beat.title}</strong>
                  <p className="small muted">
                    {beat.threadKey} · {beat.manuscriptRecordId}
                    {beat.decision ? ` · ${beat.decision}` : ""}
                  </p>
                  {beat.body ? <p className="small">{beat.body}</p> : null}
                  <p className="small">{WEAVE.buildSourcePassage}</p>
                  <blockquote className="weave-build-excerpt">
                    {beat.sourcePassage?.excerpt ?? beat.sourceExcerpt}
                    {beat.sourcePassage ? (
                      <span className="muted">
                        {" "}
                        (rev {beat.sourcePassage.revisionNumber}, {beat.sourcePassage.start}–{beat.sourcePassage.end})
                      </span>
                    ) : (
                      <span className="muted"> (passage not located in source)</span>
                    )}
                  </blockquote>
                  <DecisionRow value={d} onChange={(decision) => setDecision(beat.key, { decision })} />
                  {existingBeats.length ? (
                    <label className="small">
                      {WEAVE.buildMatchBeat}
                      <select
                        value={decisions[beat.key]?.matchBeatId ?? ""}
                        onChange={(e) =>
                          setDecision(beat.key, {
                            decision: decisions[beat.key]?.decision ?? "accept",
                            matchBeatId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{WEAVE.buildNoMatch}</option>
                        {existingBeats.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <h3>{WEAVE.buildExistingBeside}</h3>
          {run.existingGrid ? (
            <>
              <p>
                <Link href={`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(run.existingGrid.id)}`}>
                  {run.existingGrid.title}
                </Link>{" "}
                <span className="small muted">{WEAVE.beatsCount(run.existingGrid.beats.length)}</span>
              </p>
              <ul className="stack">
                {run.existingGrid.threads.map((t) => (
                  <li key={t.id} className="small">
                    Thread: {t.title}
                  </li>
                ))}
                {run.existingGrid.beats.map((b) => (
                  <li key={b.id} className="small">
                    {b.title}
                    {b.manuscriptTitle ? ` · ${b.manuscriptTitle}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted">{WEAVE.buildNewGrid}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function DecisionRow({
  value,
  onChange,
}: {
  value: "accept" | "skip" | "pending";
  onChange: (d: "accept" | "skip" | "pending") => void;
}) {
  return (
    <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
      <Button
        type="button"
        size="sm"
        variant={value === "accept" ? "primary" : "secondary"}
        onClick={() => onChange("accept")}
      >
        {WEAVE.buildAccept}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "skip" ? "primary" : "secondary"}
        onClick={() => onChange("skip")}
      >
        {WEAVE.buildSkip}
      </Button>
      <span className="small muted">{value === "pending" ? WEAVE.buildPending : null}</span>
    </div>
  );
}
