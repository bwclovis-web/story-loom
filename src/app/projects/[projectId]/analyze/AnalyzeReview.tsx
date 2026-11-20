"use client";

import { useState } from "react";
import type { AnalysisAction, AnalysisDecisions, AnalysisProposal, AnalysisSuggestion } from "@/analyze/chapterAnalysisOutput";
import { Button } from "@/components/ui/Button";
import { ANALYZE } from "@/ui/labels";
import { applyChapterAnalysisAction, saveChapterAnalysisDecisionsAction } from "./actions";

const ACTIONS: AnalysisAction[] = ["pending", "reuse", "edit", "create", "skip"];

function groupsOf(proposal: AnalysisProposal) {
  const groups: { excerpt: string; items: AnalysisSuggestion[] }[] = [];
  for (const item of proposal.suggestions) {
    const excerpt = item.passage?.excerpt ?? "";
    const found = groups.find((group) => group.excerpt === excerpt);
    if (found) found.items.push(item);
    else groups.push({ excerpt, items: [item] });
  }
  return groups;
}

export function AnalyzeReview({
  projectId,
  runId,
  contentHash,
  proposal,
  initialDecisions,
  sentMaterial,
  requestChars,
  characters,
  canApply,
}: {
  projectId: string;
  runId: string;
  contentHash: string;
  proposal: AnalysisProposal;
  initialDecisions: AnalysisDecisions;
  sentMaterial: string;
  requestChars: number;
  characters: { id: string; title: string }[];
  canApply: boolean;
}) {
  const [decisions, setDecisions] = useState<AnalysisDecisions>(initialDecisions);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<AnalysisDecisions[string]>) => {
    const current = decisions[key] ?? { action: "pending" as const };
    const next = { ...decisions, [key]: { ...current, ...patch } };
    setDecisions(next);
    void saveChapterAnalysisDecisionsAction(projectId, runId, next);
  };

  const apply = async () => {
    setBusy(true);
    setMessage("");
    const result = await applyChapterAnalysisAction(projectId, runId, contentHash, decisions);
    setBusy(false);
    setMessage(result.ok ? (result.result.status === "already_applied" ? ANALYZE.alreadyApplied : ANALYZE.applied) : result.message);
  };

  return (
    <div>
      <p>
        {ANALYZE.requestChars}: {requestChars.toLocaleString("en-US")}
      </p>
      <details>
        <summary>{ANALYZE.sent}</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{sentMaterial}</pre>
      </details>
      {groupsOf(proposal).map((group) => (
        <section key={group.excerpt || "missing"} style={{ marginTop: "1.5rem" }}>
          <h2>{ANALYZE.passage}</h2>
          {group.excerpt ? <blockquote>{group.excerpt}</blockquote> : <p>{ANALYZE.noQuote}</p>}
          <ul>
            {group.items.map((item) => {
              const decision = decisions[item.key] ?? { action: "pending" as const };
              const needsTarget = item.match.status === "ambiguous" || (item.kind === "reference_evidence" && decision.action === "create");
              const options = item.kind === "reference_evidence" && decision.action === "create" ? characters : item.match.candidates;
              return (
                <li key={item.key} style={{ marginBottom: "1rem" }}>
                  <p>
                    <strong>{ANALYZE.kind[item.kind]}:</strong> {item.title}
                  </p>
                  {item.note ? <p>{item.note}</p> : null}
                  {item.uncertain ? (
                    <p>
                      <strong>{ANALYZE.uncertain}.</strong> {item.uncertainty}
                    </p>
                  ) : null}
                  {item.kind === "chronology" ? (
                    <p>
                      {item.earlierTitle} is before {item.laterTitle}
                    </p>
                  ) : null}
                  <p>
                    {item.match.status === "unique"
                      ? `Matches ${item.match.candidates[0]?.title ?? "one record"}.`
                      : item.match.status === "ambiguous"
                        ? `Matches ${item.match.candidates.length} records.`
                        : item.match.status === "invalid_quote"
                          ? ANALYZE.noQuote
                          : "No existing record matches."}
                    {item.kind === "reference_evidence" && item.match.candidates[0]?.evidenceCount === 0
                      ? " This accepted fact has no pinned passage yet."
                      : ""}
                  </p>
                  <label>
                    Choice
                    <select
                      aria-label={`Choice for ${item.title}`}
                      value={decision.action}
                      disabled={!item.quoteValid}
                      onChange={(event) => update(item.key, { action: event.target.value as AnalysisAction })}
                    >
                      {ACTIONS.map((action) => (
                        <option key={action} value={action}>
                          {action === "pending"
                            ? ANALYZE.pending
                            : action === "reuse"
                              ? ANALYZE.reuse
                              : action === "edit"
                                ? ANALYZE.edit
                                : action === "create"
                                  ? ANALYZE.create
                                  : ANALYZE.skip}
                        </option>
                      ))}
                    </select>
                  </label>
                  {needsTarget ? (
                    <label>
                      Record
                      <select
                        aria-label={`Record for ${item.title}`}
                        value={decision.targetId ?? ""}
                        onChange={(event) => update(item.key, { targetId: event.target.value })}
                      >
                        <option value="">Choose</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.title}
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
      ))}
      {canApply ? (
        <Button type="button" disabled={busy} onClick={() => void apply()}>
          {busy ? ANALYZE.applying : ANALYZE.apply}
        </Button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
