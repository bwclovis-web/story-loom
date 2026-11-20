"use client";

import { useId, useState } from "react";
import type {
  AnalysisAction,
  AnalysisAssessment,
  AnalysisAssessments,
  AnalysisDecisions,
  AnalysisProposal,
  AnalysisSuggestion,
} from "@/analyze/chapterAnalysisOutput";
import { ANALYSIS_ASSESSMENTS } from "@/analyze/chapterAnalysisOutput";
import { actionExplanation, CATEGORY_BOUNDARY, describeWrites, effectOf, passageContext, summarizeRun } from "@/analyze/chapterAnalysisReview";
import { Button } from "@/components/ui/Button";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { ANALYZE } from "@/ui/labels";
import { applyChapterAnalysisAction, saveChapterAnalysisAssessmentsAction, saveChapterAnalysisDecisionsAction } from "./actions";
import { ReviewDisclosure } from "./ReviewDisclosure";

const ACTIONS: AnalysisAction[] = ["pending", "reuse", "edit", "create", "skip"];

function groupsOf(proposal: AnalysisProposal) {
  const groups: { excerpt: string; items: AnalysisSuggestion[] }[] = [];
  for (const item of proposal.suggestions) {
    const excerpt = item.passage?.excerpt ?? item.blockedReason ?? "";
    const found = groups.find((group) => group.excerpt === excerpt);
    if (found) found.items.push(item);
    else groups.push({ excerpt, items: [item] });
  }
  return groups;
}

function actionLabel(action: AnalysisAction): string {
  if (action === "pending") return ANALYZE.pending;
  if (action === "reuse") return ANALYZE.reuse;
  if (action === "edit") return ANALYZE.edit;
  if (action === "create") return ANALYZE.create;
  return ANALYZE.skip;
}

export function AnalyzeReview({
  projectId,
  runId,
  contentHash,
  proposal,
  chapterBody,
  initialDecisions,
  initialAssessments,
  appliedKeys,
  sentMaterial,
  requestChars,
  outputTokenAllowance,
  usage,
  characters,
  canApply,
}: {
  projectId: string;
  runId: string;
  contentHash: string;
  proposal: AnalysisProposal;
  chapterBody: string;
  initialDecisions: AnalysisDecisions;
  initialAssessments: AnalysisAssessments;
  appliedKeys: string[];
  sentMaterial: string;
  requestChars: number;
  outputTokenAllowance: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimated: boolean } | null;
  characters: { id: string; title: string }[];
  canApply: boolean;
}) {
  const [decisions, setDecisions] = useState<AnalysisDecisions>(initialDecisions);
  const [assessments, setAssessments] = useState<AnalysisAssessments>(initialAssessments);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const summary = summarizeRun(proposal.suggestions, decisions, assessments, appliedKeys, usage);
  const writes = describeWrites(proposal.suggestions, decisions);
  const selected = proposal.suggestions.filter((item) => {
    const action = decisions[item.key]?.action ?? "pending";
    return action === "reuse" || action === "edit" || action === "create";
  }).length;
  const byKey = new Map(proposal.suggestions.map((item) => [item.key, item]));

  const update = (key: string, patch: Partial<AnalysisDecisions[string]>) => {
    const current = decisions[key] ?? { action: "pending" as const };
    const next = { ...decisions, [key]: { ...current, ...patch } };
    setDecisions(next);
    void saveChapterAnalysisDecisionsAction(projectId, runId, next);
  };

  const assess = (key: string, value: string) => {
    const next = { ...assessments };
    if (ANALYSIS_ASSESSMENTS.includes(value as AnalysisAssessment)) next[key] = value as AnalysisAssessment;
    else delete next[key];
    setAssessments(next);
    void saveChapterAnalysisAssessmentsAction(projectId, runId, next);
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
      <h2>{ANALYZE.summary}</h2>
      <p>{ANALYZE.reviewIntro}</p>
      <ReviewDisclosure summary={ANALYZE.howReview}>
        <ul>
          <li>{ANALYZE.examplePlace}</li>
          <li>{ANALYZE.exampleKnowledge}</li>
          <li>{ANALYZE.exampleDetail}</li>
          <li>{ANALYZE.notDuplicate}</li>
        </ul>
      </ReviewDisclosure>
      <ul>
        {summary.byCategory
          .filter((row) => row.count > 0)
          .map((row) => (
            <li key={row.kind}>
              {ANALYZE.kind[row.kind]}: {row.count}
            </li>
          ))}
        <li>
          Selected to save {selected}. Applied {summary.applied}. Skipped {summary.skipped}. Not chosen {summary.pending}.
        </li>
        <li>
          {ANALYZE.requestChars}: {requestChars.toLocaleString("en-US")}. {ANALYZE.outputAllowance}: {outputTokenAllowance.toLocaleString("en-US")} tokens.
          {usage
            ? ` Provider reported ${usage.inputTokens.toLocaleString("en-US")} input and ${usage.outputTokens.toLocaleString("en-US")} output tokens${usage.estimated ? " (estimated from length, not a price)" : ""}.`
            : " The provider did not report token use."}
        </li>
      </ul>
      <details>
        <summary>{ANALYZE.sent}</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{sentMaterial}</pre>
      </details>
      {groupsOf(proposal).map((group) => (
        <section key={group.excerpt || "missing"} style={{ marginTop: "1.5rem" }}>
          <h2>{ANALYZE.passage}</h2>
          {group.items.some((item) => item.passage) ? <blockquote>{group.excerpt}</blockquote> : <p>{group.excerpt || ANALYZE.noQuote}</p>}
          <ul>
            {group.items.map((item) => {
              const decision = decisions[item.key] ?? { action: "pending" as const };
              const verified = item.passageVerified ?? item.quoteValid;
              const needsTarget = item.match.status === "ambiguous" || (item.kind === "reference_evidence" && decision.action === "create");
              const options = item.kind === "reference_evidence" && decision.action === "create" ? characters : item.match.candidates;
              const matched = item.match.status === "none" || item.match.status === "invalid_quote" ? null : item.match.candidates[0];
              const context = item.passage ? passageContext(chapterBody, item.passage.start, item.passage.end) : null;
              const open = openKey === item.key;
              return (
                <li key={item.key} style={{ marginBottom: "1rem" }}>
                  <p>
                    <button type="button" onClick={() => setOpenKey(open ? null : item.key)}>
                      <strong>{ANALYZE.kind[item.kind]}:</strong> {item.title}
                    </button>
                  </p>
                  {open && context ? (
                    <p>
                      {ANALYZE.context}: {context.before}
                      <mark>{context.excerpt}</mark>
                      {context.after}
                    </p>
                  ) : null}
                  <p>
                    {ANALYZE.says}: {item.passage?.excerpt ?? ANALYZE.noQuote}
                  </p>
                  <p>
                    {ANALYZE.proposes}: {item.note || item.title}
                  </p>
                  <p>{item.boundary || CATEGORY_BOUNDARY[item.kind]}</p>
                  {verified ? (
                    <p>
                      <strong>{ANALYZE.passageVerified}.</strong> {ANALYZE.passageMeans}
                    </p>
                  ) : (
                    <p>{item.blockedReason || ANALYZE.noQuote}</p>
                  )}
                  <p>
                    {item.match.status === "unique"
                      ? `${ANALYZE.matched}: ${matched?.title ?? "one record"}.`
                      : item.match.status === "ambiguous"
                        ? `${ANALYZE.matched}: ${item.match.candidates.length} records. Choose one.`
                        : ANALYZE.newRecord}
                    {item.kind === "reference_evidence" && item.match.candidates[0]?.evidenceCount === 0
                      ? " This accepted fact has no pinned passage yet."
                      : ""}
                  </p>
                  {item.uncertain ? (
                    <p>
                      <strong>{ANALYZE.uncertain}.</strong> {item.uncertainty}
                    </p>
                  ) : null}
                  {item.kind === "chronology" ? (
                    <p>
                      Proposed direction: {item.earlierTitle} is before {item.laterTitle}.
                    </p>
                  ) : null}
                  {item.dependsOnKeys.map((key) => {
                    const other = byKey.get(key);
                    const otherAction = decisions[key]?.action ?? "pending";
                    const selected = otherAction === "reuse" || otherAction === "edit" || otherAction === "create" || appliedKeys.includes(key);
                    return (
                      <p key={key}>
                        {selected
                          ? `Depends on “${other?.title ?? key}”, which is selected.`
                          : `Depends on “${other?.title ?? key}”, which is not selected. Choose that one too, or skip this one.`}
                      </p>
                    );
                  })}
                  <p>
                    {ANALYZE.willChange}: {effectOf(item, decision.action)}
                  </p>
                  <SaveField item={item} action={decision.action} onChange={(action) => update(item.key, { action })} />
                  {decision.action === "edit" ? (
                    <p>
                      <label>
                        Title
                        <input
                          aria-label={`Edited title for ${item.title}`}
                          value={decision.title ?? item.title}
                          onChange={(event) => update(item.key, { title: event.target.value })}
                        />
                      </label>
                      <label>
                        Note
                        <input
                          aria-label={`Edited note for ${item.title}`}
                          value={decision.note ?? item.note}
                          onChange={(event) => update(item.key, { note: event.target.value })}
                        />
                      </label>
                    </p>
                  ) : null}
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
                  <RateField item={item} value={assessments[item.key] ?? ""} onChange={(value) => assess(item.key, value)} />
                  <details>
                    <summary>{ANALYZE.details}</summary>
                    <p>
                      Suggestion {item.key}
                      {item.passage ? `, offsets ${item.passage.start}–${item.passage.end}` : ""}.
                      {item.match.candidates.map((candidate) => ` ${candidate.kind} ${candidate.id}`).join("")}
                    </p>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {canApply ? (
        <section>
          <h2>{ANALYZE.writes}</h2>
          <p className="hint">{ANALYZE.writesNote}</p>
          {selected === 0 ? <p>{ANALYZE.nothingSelected}</p> : null}
          {(
            [
              ["records", writes.records],
              ["links", writes.links],
              ["evidence", writes.evidence],
              ["events", writes.events],
              ["beats", writes.beats],
              ["blocked", writes.blocked],
            ] as const
          ).map(([key, lines]) => (
            <div key={key}>
              <h3>{ANALYZE[key]}</h3>
              {lines.length ? (
                <ul>
                  {lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p>{ANALYZE.none}</p>
              )}
            </div>
          ))}
          <h2>{ANALYZE.ratingsHeading}</h2>
          <p className="hint">{ANALYZE.ratingsNote}</p>
          <ul>
            <li>
              {ANALYZE.assessments.correct}: {summary.assessments.correct}
            </li>
            <li>
              {ANALYZE.assessments.needs_editing}: {summary.assessments.needs_editing}
            </li>
            <li>
              {ANALYZE.assessments.unsupported}: {summary.assessments.unsupported}
            </li>
            <li>
              {ANALYZE.assessments.duplicate}: {summary.assessments.duplicate}
            </li>
            <li>
              {ANALYZE.notAssessed}: {summary.assessments.unassessed}
            </li>
          </ul>
          <Button type="button" disabled={busy} onClick={() => void apply()}>
            {busy ? ANALYZE.applying : ANALYZE.apply}
          </Button>
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

function SaveField({
  item,
  action,
  onChange,
}: {
  item: AnalysisSuggestion;
  action: AnalysisAction;
  onChange: (action: AnalysisAction) => void;
}) {
  const selectId = useId();
  const chosenId = useId();
  const options = ACTIONS.filter((option) => item.quoteValid || option === "pending" || option === "skip");
  return (
    <div className="review-field">
      <div className="review-label-row">
        <label htmlFor={selectId}>{ANALYZE.save}</label>
        <HelpPopover label={ANALYZE.saveExplain}>{ANALYZE.saveHelp}</HelpPopover>
      </div>
      <select
        id={selectId}
        aria-describedby={action === "pending" ? undefined : chosenId}
        aria-label={`${ANALYZE.save} for ${item.title}`}
        value={action}
        onChange={(event) => onChange(event.target.value as AnalysisAction)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {actionLabel(option)}
          </option>
        ))}
      </select>
      {action !== "pending" ? (
        <p id={chosenId} className="hint">
          {actionExplanation(item.kind, action)}
        </p>
      ) : null}
      <ReviewDisclosure summary={ANALYZE.choiceHelp}>
        <ul>
          {options
            .filter((option) => option !== "pending")
            .map((option) => (
              <li key={option}>
                <strong>{actionLabel(option)}.</strong> {actionExplanation(item.kind, option)}
              </li>
            ))}
        </ul>
      </ReviewDisclosure>
    </div>
  );
}

function RateField({ item, value, onChange }: { item: AnalysisSuggestion; value: string; onChange: (value: string) => void }) {
  const selectId = useId();
  const chosenId = useId();
  const mark = ANALYSIS_ASSESSMENTS.find((option) => option === value);
  return (
    <div className="review-field">
      <div className="review-label-row">
        <label htmlFor={selectId}>{ANALYZE.assessment}</label>
        <HelpPopover label={ANALYZE.rateExplain}>{ANALYZE.assessmentNote}</HelpPopover>
      </div>
      <select
        id={selectId}
        aria-describedby={mark ? chosenId : undefined}
        aria-label={`${ANALYZE.assessment} for ${item.title}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{ANALYZE.notAssessed}</option>
        {ANALYSIS_ASSESSMENTS.map((option) => (
          <option key={option} value={option}>
            {ANALYZE.assessments[option]}
          </option>
        ))}
      </select>
      {mark ? (
        <p id={chosenId} className="hint">
          {ANALYZE.assessmentHelp[mark]}
        </p>
      ) : null}
      <ReviewDisclosure summary={ANALYZE.ratingHelp}>
        <ul>
          {ANALYSIS_ASSESSMENTS.map((option) => (
            <li key={option}>
              <strong>{ANALYZE.assessments[option]}.</strong> {ANALYZE.assessmentHelp[option]}
            </li>
          ))}
        </ul>
      </ReviewDisclosure>
    </div>
  );
}
