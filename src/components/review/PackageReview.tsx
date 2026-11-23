"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type Dispatch, type KeyboardEvent, type Ref } from "react";
import { CANON_REASON_TEXT, canonChanges } from "@/assistant/canon";
import { IssueList } from "@/components/IssueList";
import { ResultSummary } from "@/components/PackagePreview";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { PackagePreview } from "@/server/services/changePackageService";
import { REVIEW } from "@/ui/labels";
import {
  canSubmit,
  initialReviewState,
  isFinished,
  reviewReducer,
  reviewRecords,
  reviewSummary,
  singleFlight,
  validationState,
  type ApplyResponse,
  type ReviewAction,
  type ReviewState,
  type ValidationState,
} from "@/ui/packageReview";
import { ReviewDiff } from "./ReviewDiff";
/*
 * The change review screen. It shows exactly what the validated package would
 * do and applies it whole through the caller's action; selecting a record only
 * changes which comparison is shown.
 */

const RECHECK_MS = 30_000;

export type ReviewBack = { label: string; href: string } | { label: string; onClick: () => void };

export interface PackageReviewProps {
  projectId: string;
  initialPreview: PackagePreview;
  /** "proposal" adds the canon confirmation and points stale proposals back to the discussion. */
  kind: "package" | "proposal";
  conversation: { id: string; title: string } | null;
  preparedAt?: string;
  back: ReviewBack;
  /** Time of the check that produced initialPreview (ms since epoch). */
  checkedAt: number;
  onApply: (confirm: { protected: boolean; canon: boolean }) => Promise<ApplyResponse>;
  /** Validates the same package again. Null when the check could not run. */
  onCheck: () => Promise<PackagePreview | null>;
}

function stateLabel(state: ValidationState, errorCount: number): string {
  switch (state) {
    case "ready":
      return REVIEW.stateReady;
    case "stale":
      return REVIEW.stateStale;
    case "not_approved":
      return REVIEW.stateNotApproved;
    case "already_applied":
      return REVIEW.stateAlreadyApplied;
    default:
      return REVIEW.stateInvalid(errorCount);
  }
}

function BackControl({ back }: { back: ReviewBack }) {
  return "href" in back ? (
    <ButtonLink variant="secondary" href={back.href}>
      {back.label}
    </ButtonLink>
  ) : (
    <Button type="button" variant="secondary" onClick={back.onClick}>
      {back.label}
    </Button>
  );
}

export function PackageReview(props: PackageReviewProps) {
  const { projectId, kind, onApply, onCheck } = props;
  const router = useRouter();
  const [state, dispatch] = useReducer(
    (s: ReviewState, a: ReviewAction) =>
      reviewReducer(s, a, { canonRequired: kind === "proposal" && canonChanges(s.preview.operations).length > 0 }),
    undefined,
    () => initialReviewState(props.initialPreview, props.checkedAt),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const focusOutcome = useRef(false);
  const applying = state.phase.kind === "applying";
  const finished = isFinished(state.phase);

  useEffect(() => {
    if (!focusOutcome.current || !outcomeRef.current) return;
    focusOutcome.current = false;
    outcomeRef.current.focus();
  }, [state.phase]);

  const staleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state.becameStale || focusOutcome.current) return;
    if (document.activeElement === document.body) staleRef.current?.focus();
  }, [state.becameStale]);

  const checkingRef = useRef(false);
  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    dispatch({ type: "checking" });
    try {
      const next = await onCheck();
      if (next) dispatch({ type: "checked", preview: next, at: Date.now() });
      else dispatch({ type: "checkFailed", at: Date.now() });
    } catch {
      dispatch({ type: "checkFailed", at: Date.now() });
    } finally {
      checkingRef.current = false;
    }
  }, [onCheck]);

  useEffect(() => {
    if (finished || applying) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, RECHECK_MS);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [check, finished, applying]);

  const apply = useMemo(
    () =>
      singleFlight(async () => {
        const s = stateRef.current;
        if (!canSubmit(s, { canonRequired: kind === "proposal" && canonChanges(s.preview.operations).length > 0 })) return;
        dispatch({ type: "submit" });
        let response: ApplyResponse;
        try {
          response = await onApply({ protected: s.confirmProtected, canon: s.confirmCanon });
        } catch {
          response = { status: "failed", message: REVIEW.failed };
        }
        focusOutcome.current = true;
        dispatch({ type: "response", response });
        if (response.status === "applied") router.refresh();
        if (response.status === "rejected" || response.status === "failed") {
          checkingRef.current = false;
          await check();
        }
      }),
    [kind, onApply, check, router],
  );

  return (
    <PackageReviewView
      state={state}
      dispatch={dispatch}
      projectId={projectId}
      kind={kind}
      conversation={props.conversation}
      preparedAt={props.preparedAt}
      back={props.back}
      mounted={mounted}
      outcomeRef={outcomeRef}
      staleRef={staleRef}
      onApply={() => void apply()}
      onCheck={() => void check()}
    />
  );
}

export interface PackageReviewViewProps {
  state: ReviewState;
  dispatch: Dispatch<ReviewAction>;
  projectId: string;
  kind: "package" | "proposal";
  conversation: { id: string; title: string } | null;
  preparedAt?: string;
  back: ReviewBack;
  /** Local times are shown only after hydration, so server and browser markup match. */
  mounted: boolean;
  outcomeRef?: Ref<HTMLDivElement>;
  staleRef?: Ref<HTMLDivElement>;
  onApply: () => void;
  onCheck: () => void;
}

/** The screen itself, rendered from the review state. */
export function PackageReviewView(props: PackageReviewViewProps) {
  const { state, dispatch, projectId, kind, mounted, outcomeRef } = props;
  const uid = useId();
  const recordsHeadingId = `${uid}-records`;
  const diffHeadingId = `${uid}-diff`;
  const summaryHeadingId = `${uid}-summary`;
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const preview = state.preview;
  const records = useMemo(() => reviewRecords(preview), [preview]);
  const summary = useMemo(() => reviewSummary(preview, records), [preview, records]);
  const canon = useMemo(() => (kind === "proposal" ? canonChanges(preview.operations) : []), [kind, preview]);
  const canonRequired = canon.length > 0;
  const vstate = validationState(preview);
  const errors = preview.issues.filter((i) => i.severity === "error");
  const warnings = preview.issues.filter((i) => i.severity === "warning");
  const selectedIndex = records.findIndex((r) => r.recordId === state.selectedId);
  const selected = selectedIndex >= 0 ? records[selectedIndex] : null;
  const phase = state.phase;
  const applying = phase.kind === "applying";
  const finished = isFinished(phase);

  const select = (recordId: string, focus = false) => {
    dispatch({ type: "select", recordId });
    if (focus) buttons.current.get(recordId)?.focus();
  };

  const onListKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = -1;
    if (e.key === "ArrowDown") target = Math.min(records.length - 1, index + 1);
    else if (e.key === "ArrowUp") target = Math.max(0, index - 1);
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = records.length - 1;
    if (target < 0) return;
    e.preventDefault();
    select(records[target].recordId, true);
  };

  const header = preview.header;
  const sourceUrl = header?.source?.url ?? null;
  const sourceLabel = header?.source?.conversationLabel ?? null;
  const submitAllowed = canSubmit(state, { canonRequired });
  const timeText = mounted ? new Date(state.checkedAt).toLocaleTimeString() : "";

  const outcomeBanner =
    phase.kind === "applied" ? (
      <Banner tone="ok" tabIndex={-1} ref={outcomeRef}>
        {REVIEW.applied} <Link href={`/projects/${projectId}/history`}>{REVIEW.viewHistory}</Link>
      </Banner>
    ) : phase.kind === "already_applied" ? (
      <Banner tone="info" tabIndex={-1} ref={outcomeRef}>
        {REVIEW.alreadyApplied} <Link href={`/projects/${projectId}/history`}>{REVIEW.viewHistory}</Link>
      </Banner>
    ) : phase.kind === "rejected" ? (
      <Banner tone="error" role="alert" title={REVIEW.rejected} tabIndex={-1} ref={outcomeRef}>
        <IssueList issues={phase.issues} />
      </Banner>
    ) : phase.kind === "failed" ? (
      <Banner tone="error" role="alert" title={phase.message} tabIndex={-1} ref={outcomeRef}>
        {phase.message !== REVIEW.failed ? <p>{REVIEW.failed}</p> : null}
      </Banner>
    ) : null;

  return (
    <div className="review" aria-busy={applying || undefined}>
      <header className="review-header panel">
        <div className="review-title-row">
          <h2 className="review-title">{header?.summary ?? REVIEW.untitledPackage}</h2>
          <span className={`review-state ${finished ? "already_applied" : vstate}`}>
            {phase.kind === "applied" ? REVIEW.stateApplied : stateLabel(finished ? "already_applied" : vstate, errors.length)}
          </span>
        </div>
        {header ? (
          <p className="small muted review-meta">
            Package <code>{header.packageId}</code> &middot; scope <strong>{header.scope}</strong>
            {props.preparedAt && mounted ? <> &middot; prepared {new Date(props.preparedAt).toLocaleString()}</> : null}
          </p>
        ) : null}
        {props.conversation ? (
          <p className="small review-source">
            {REVIEW.fromConversation}:{" "}
            <Link href={`/projects/${projectId}/assistant?c=${encodeURIComponent(props.conversation.id)}`}>{props.conversation.title}</Link>
          </p>
        ) : sourceLabel || sourceUrl ? (
          <p className="small review-source">
            {REVIEW.sourceLabel}: {sourceLabel}{" "}
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                {sourceUrl}
              </a>
            ) : null}
          </p>
        ) : null}
      </header>

      {outcomeBanner}

      {phase.kind === "applied" || phase.kind === "already_applied" ? (
        <div className="stack">
          {phase.kind === "applied" ? <IssueList issues={phase.warnings} /> : null}
          <ResultSummary result={phase.result} projectId={projectId} />
          <div className="review-actions">
            <BackControl back={props.back} />
          </div>
        </div>
      ) : !header ? (
        <div className="panel stack">
          <IssueList issues={errors} />
          <p className="small">{REVIEW.invalidExplanation}</p>
          <div className="review-actions">
            <BackControl back={props.back} />
          </div>
        </div>
      ) : (
        <div className="review-layout">
          <nav className="review-records panel" aria-labelledby={recordsHeadingId}>
            <h2 id={recordsHeadingId} className="review-panel-title">
              {REVIEW.recordsHeading} ({records.length})
            </h2>
            <p className="small muted">{REVIEW.recordsNote}</p>
            <ul className="review-record-list">
              {records.map((r, i) => {
                const isSelected = r.recordId === state.selectedId;
                return (
                  <li key={r.recordId}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) buttons.current.set(r.recordId, el);
                        else buttons.current.delete(r.recordId);
                      }}
                      className="review-record-button"
                      aria-current={isSelected ? "true" : undefined}
                      aria-controls={diffHeadingId}
                      onClick={() => select(r.recordId)}
                      onKeyDown={(e) => onListKey(e, i)}
                    >
                      <span className="review-record-title">{r.title}</span>
                      <span className="review-record-type">{RECORD_TYPE_LABELS[r.type]}</span>
                      <span className="review-record-changes">{r.changes.join(" · ")}</span>
                      {r.stale ? (
                        <span className="badge stale">{REVIEW.badgeStale}</span>
                      ) : r.errors.length ? (
                        <span className="badge protected">{REVIEW.badgeProblem}</span>
                      ) : null}
                      {r.contentClass === "manuscript" ? <span className="badge manuscript">{REVIEW.badgeManuscript}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="review-main panel" aria-labelledby={diffHeadingId}>
            {records.length > 1 ? (
              <div className="review-pager">
                <Button type="button" variant="secondary" onClick={() => dispatch({ type: "move", by: -1 })} disabled={selectedIndex <= 0}>
                  <span aria-hidden="true">&lsaquo;</span> {REVIEW.previous}
                </Button>
                <span className="small" aria-live="polite">
                  {REVIEW.position(selectedIndex + 1, records.length)}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => dispatch({ type: "move", by: 1 })}
                  disabled={selectedIndex >= records.length - 1}
                >
                  {REVIEW.next} <span aria-hidden="true">&rsaquo;</span>
                </Button>
              </div>
            ) : null}
            {selected ? (
              <ReviewDiff record={selected} projectId={projectId} headingId={diffHeadingId} />
            ) : (
              <>
                <h2 id={diffHeadingId}>{REVIEW.recordsHeading}</h2>
                <p className="muted">No operations to show.</p>
              </>
            )}
          </section>

          <aside className="review-summary panel" aria-labelledby={summaryHeadingId}>
            <h2 id={summaryHeadingId} className="review-panel-title">
              {REVIEW.summaryHeading}
            </h2>

            <section className="review-summary-item">
              <h3>{REVIEW.recordsUpdated(summary.updatedCount, summary.createdCount)}</h3>
              <ul className="small">
                {records.map((r) => (
                  <li key={r.recordId}>
                    {r.title} <span className="muted">({r.changes.join(", ")})</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="review-summary-item">
              {summary.manuscriptRecords.length === 0 ? (
                <>
                  <h3>{REVIEW.manuscriptUnchanged}</h3>
                  <p className="small muted">{REVIEW.manuscriptUnchangedNote}</p>
                </>
              ) : (
                <>
                  <h3 className="review-warn">{REVIEW.manuscriptChanged(summary.manuscriptRecords.length)}</h3>
                  <ul className="small">
                    {summary.manuscriptRecords.map((r) => (
                      <li key={r.recordId}>
                        {r.title} <span className="muted">({RECORD_TYPE_LABELS[r.type]})</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {summary.manuscriptMentions > 0 ? <p className="small">{REVIEW.manuscriptMentions(summary.manuscriptMentions)}</p> : null}
            </section>

            <section className="review-summary-item">
              <h3>{REVIEW.protectionHeading}</h3>
              {summary.protectedRecords.length === 0 ? (
                <p className="small muted">{REVIEW.noProtected}</p>
              ) : (
                <ul className="small">
                  {summary.protectedRecords.map((p) => (
                    <li key={p.recordId}>
                      <strong>{p.title}</strong>: {p.override ? REVIEW.protectedOverride : REVIEW.protectedNoOverride}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="review-summary-item">
              <h3>{REVIEW.revisionsHeading}</h3>
              {summary.revisionChecks.length === 0 ? (
                <p className="small muted">{REVIEW.revisionsNone}</p>
              ) : summary.staleCount === 0 ? (
                <p className="small">
                  <strong>{REVIEW.revisionsVerified}.</strong> {REVIEW.revisionsVerifiedNote}
                </p>
              ) : (
                <p className="small review-warn">
                  <strong>{REVIEW.revisionsStale(summary.staleCount)}.</strong>
                </p>
              )}
              {summary.revisionChecks.length ? (
                <ul className="small">
                  {summary.revisionChecks.map((c) => (
                    <li key={c.recordId}>
                      {c.title}: {REVIEW.revisionLine(c.expected, c.current)} <span className={c.ok ? "review-ok" : "review-warn"}>({c.ok ? "matches" : "changed"})</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="small muted">
                {timeText ? REVIEW.checkedAt(timeText) : null}{" "}
                <button type="button" className="link-button" onClick={props.onCheck} disabled={state.checking || applying}>
                  {state.checking ? REVIEW.checking : REVIEW.checkAgain}
                </button>
              </p>
            </section>

            <section className="review-summary-item">
              <h3>{REVIEW.affectedHeading}</h3>
              {summary.affectedCount === 0 ? (
                <p className="small muted">{REVIEW.noAffected}</p>
              ) : (
                <>
                  <p className="small muted">{REVIEW.affectedNote}</p>
                  <ul className="small">
                    {preview.relatedNotes.map((n, i) => (
                      <li key={`n${i}`}>
                        <strong>{n.title ?? n.recordId}</strong> <span className="muted">({kind === "proposal" ? "review note" : "package note"})</span> {n.note}
                      </li>
                    ))}
                    {preview.potentialEffects.map((e, i) => (
                      <li key={`e${i}`}>
                        <Link href={`/projects/${projectId}/records/${e.recordId}`} target="_blank" rel="noopener noreferrer">
                          {e.title}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </Link>{" "}
                        <span className="muted">({RECORD_TYPE_LABELS[e.type]}{e.protected ? ", protected" : ""})</span> mentions{" "}
                        {e.matchedTerms.map((t) => `"${t}"`).join(", ")} from {e.triggeredByTitle}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <IssueList issues={warnings} />

            <section className="review-summary-item review-decision" aria-label="Apply">
              {vstate === "ready" ? (
                <>
                  {summary.requiresProtectedConfirmation ? (
                    <Checkbox
                      className="review-confirm"
                      checked={state.confirmProtected}
                      onChange={(e) => dispatch({ type: "confirmProtected", value: e.target.checked })}
                      disabled={applying}
                      label={REVIEW.confirmProtected}
                    />
                  ) : null}
                  {canonRequired ? (
                    <div className="stack">
                      <ul className="small">
                        {canon.map((c) => (
                          <li key={c.index}>
                            <strong>{c.title}</strong> {CANON_REASON_TEXT[c.reason]}
                          </li>
                        ))}
                      </ul>
                      <Checkbox
                        className="review-confirm"
                        checked={state.confirmCanon}
                        onChange={(e) => dispatch({ type: "confirmCanon", value: e.target.checked })}
                        disabled={applying}
                        label={REVIEW.confirmCanon}
                      />
                    </div>
                  ) : null}
                  <button type="button" className="review-apply" onClick={props.onApply} disabled={!submitAllowed} aria-describedby={`${uid}-apply-note`}>
                    {applying ? REVIEW.applying : REVIEW.apply(summary.recordCount)}
                  </button>
                  <p id={`${uid}-apply-note`} className="small muted">
                    {REVIEW.applyNote}
                  </p>
                </>
              ) : vstate === "stale" ? (
                <Banner
                  tone="warn"
                  tabIndex={-1}
                  ref={props.staleRef}
                  title={state.becameStale ? REVIEW.becameStale : undefined}
                >
                  <p>{REVIEW.staleExplanation}</p>
                  <p>{kind === "proposal" ? REVIEW.staleProposal : REVIEW.staleImport}</p>
                </Banner>
              ) : vstate === "not_approved" ? (
                <Banner tone="info">{REVIEW.notApprovedExplanation}</Banner>
              ) : (
                <Banner tone="error">
                  <p>{REVIEW.invalidExplanation}</p>
                  <IssueList issues={errors} />
                </Banner>
              )}
              <div className="review-actions">
                <BackControl back={props.back} />
              </div>
              <p className="sr-only" role="status">
                {applying ? REVIEW.applying : ""}
              </p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
