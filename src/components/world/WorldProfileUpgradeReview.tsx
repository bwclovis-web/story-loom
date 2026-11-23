"use client";

import { useMemo, useState, useTransition } from "react";
import type { WorldProfileUpgradePreview, ApplyWorldProfileUpgradeResult } from "@/server/services/worldProfileUpgradeService";
import type { WorldUpgradeDecision, WorldUpgradeDecisionInput } from "@/domain/worldProfileUpgrade";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { WORLD_PROFILE_UPGRADE as LABELS } from "@/ui/labels";

type DecisionState = Record<string, { decision: WorldUpgradeDecision; modifiedValue: string }>;

function defaultDecisions(preview: WorldProfileUpgradePreview): DecisionState {
  const state: DecisionState = {};
  for (const item of preview.analysis.items) {
    const needsDefer =
      item.alreadyApplied ||
      item.requiresHumanReview ||
      (item.existingAuthority === "approved" && item.existingCanonical.trim() !== "");
    state[item.id] = {
      decision: needsDefer ? "defer" : "accept",
      modifiedValue: item.proposedValue,
    };
  }
  return state;
}

export function WorldProfileUpgradeReview({
  projectId,
  recordId,
  initial,
  onPreview,
  onApply,
  onBuildPackage,
}: {
  projectId: string;
  recordId: string;
  initial: WorldProfileUpgradePreview;
  onPreview: (markdownOverride?: string) => Promise<
    { ok: true; preview: WorldProfileUpgradePreview } | { ok: false; message: string }
  >;
  onApply: (input: {
    previewToken: string;
    decisions: WorldUpgradeDecisionInput[];
    unlockProtected: boolean;
    markdownOverride?: string;
  }) => Promise<ApplyWorldProfileUpgradeResult | { status: "failed"; message: string }>;
  onBuildPackage: (input: {
    previewToken: string;
    decisions: WorldUpgradeDecisionInput[];
    markdownOverride?: string;
  }) => Promise<{ ok: true; packageJson: string } | { ok: false; message: string }>;
}) {
  const [preview, setPreview] = useState(initial);
  const [decisions, setDecisions] = useState<DecisionState>(() => defaultDecisions(initial));
  const [unlockProtected, setUnlockProtected] = useState(false);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packageJson, setPackageJson] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decisionList = useMemo((): WorldUpgradeDecisionInput[] => {
    return preview.analysis.items.map((item) => {
      const row = decisions[item.id] ?? { decision: "defer" as const, modifiedValue: item.proposedValue };
      return {
        itemId: item.id,
        decision: row.decision,
        modifiedValue: row.decision === "modify" ? row.modifiedValue : undefined,
      };
    });
  }, [preview, decisions]);

  const recordHref = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;

  const runPreview = (markdownOverride?: string) =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      setPackageJson(null);
      const result = await onPreview(markdownOverride);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPreview(result.preview);
      setDecisions(defaultDecisions(result.preview));
      setMessage(LABELS.previewReady);
    });

  const runApply = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await onApply({
        previewToken: preview.previewToken,
        decisions: decisionList,
        unlockProtected,
        markdownOverride: paste.trim() || undefined,
      });
      if ("status" in result && result.status === "failed") {
        setError(result.message);
        return;
      }
      if (result.status === "rejected") {
        setError(result.issues.map((issue) => issue.message).join(" ") || LABELS.rejected);
        return;
      }
      if (result.status === "already_applied") {
        setMessage(LABELS.alreadyApplied);
        return;
      }
      setMessage(LABELS.applied(result.appliedItemIds.length, result.deferredItemIds.length));
    });

  return (
    <div className="stack">
      <p>{LABELS.lead}</p>
      <p className="small muted">{LABELS.authorityNote}</p>
      {preview.definitionLabel ? (
        <p className="small">
          {LABELS.definition}: <strong>{preview.definitionLabel}</strong>
        </p>
      ) : null}
      <p className="small">
        {LABELS.summary(
          preview.summary.total,
          preview.summary.needsReview,
          preview.summary.unclassified,
          preview.summary.conflicts,
          preview.archiveEntryCount,
        )}
      </p>
      {!preview.editableHere ? (
        <Banner tone="warn">
          {LABELS.homeElsewhere}{" "}
          <ButtonLink
            href={`/projects/${encodeURIComponent(preview.homeProjectId)}/records/${encodeURIComponent(recordId)}/world-upgrade`}
            variant="secondary"
          >
            {LABELS.openHomeUpgrade}
          </ButtonLink>
        </Banner>
      ) : null}
      {preview.alreadyMigrated ? <Banner tone="ok">{LABELS.alreadyMigrated}</Banner> : null}
      {preview.archiveUnsupported ? <Banner tone="error">{LABELS.archiveUnsupported}</Banner> : null}
      {message ? <Banner tone="ok">{message}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <label>
        {LABELS.pasteMarkdown}
        <textarea rows={6} value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={LABELS.pastePlaceholder} />
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => runPreview()}>
          {LABELS.preview}
        </Button>
        <Button type="button" variant="secondary" disabled={pending || !paste.trim()} onClick={() => runPreview(paste)}>
          {LABELS.analyzePaste}
        </Button>
        <ButtonLink href={recordHref} variant="secondary">
          {LABELS.backToRecord}
        </ButtonLink>
      </div>

      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {preview.analysis.items.map((item) => {
          const row = decisions[item.id] ?? { decision: "defer" as WorldUpgradeDecision, modifiedValue: item.proposedValue };
          return (
            <li key={item.id} className="panel stack">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.35rem" }}>
                <strong>{item.sourceHeading}</strong>
                <span className="small muted">{item.fieldPath}</span>
              </div>
              <p className="small">
                <span className="muted">{LABELS.sourceText}: </span>
                {item.sourceExcerpt}
              </p>
              <p className="small">
                <span className="muted">{LABELS.existingCanonical}: </span>
                {item.existingCanonical.trim() ? item.existingCanonical : LABELS.noExisting}
              </p>
              {item.requiresHumanReview ? (
                <p className="small">{LABELS.needsReview}: {item.reviewReasons.join("; ")}</p>
              ) : (
                <p className="small muted">{LABELS.ready}</p>
              )}
              {item.existingAuthority === "approved" && item.existingCanonical.trim() ? (
                <p className="small">{LABELS.canonConflict}</p>
              ) : null}
              <label>
                {LABELS.decision}
                <select
                  value={row.decision}
                  disabled={pending || !preview.editableHere}
                  onChange={(event) =>
                    setDecisions((current) => ({
                      ...current,
                      [item.id]: {
                        decision: event.target.value as WorldUpgradeDecision,
                        modifiedValue: current[item.id]?.modifiedValue ?? item.proposedValue,
                      },
                    }))
                  }
                >
                  <option value="accept">{LABELS.accept}</option>
                  <option value="keep_existing">{LABELS.keepExisting}</option>
                  <option value="merge">{LABELS.merge}</option>
                  <option value="modify">{LABELS.modify}</option>
                  <option value="reject">{LABELS.reject}</option>
                  <option value="defer">{LABELS.defer}</option>
                </select>
              </label>
              {row.decision === "modify" ? (
                <label>
                  {LABELS.modifiedValue}
                  <textarea
                    rows={3}
                    value={row.modifiedValue}
                    disabled={pending}
                    onChange={(event) =>
                      setDecisions((current) => ({
                        ...current,
                        [item.id]: { decision: "modify", modifiedValue: event.target.value },
                      }))
                    }
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>

      {preview.protected ? (
        <Checkbox
          checked={unlockProtected}
          disabled={pending || !preview.editableHere}
          onChange={(event) => setUnlockProtected(event.target.checked)}
          label={LABELS.unlockProtected}
        />
      ) : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button
          type="button"
          disabled={pending || !preview.editableHere || preview.archiveUnsupported || (preview.protected && !unlockProtected)}
          onClick={runApply}
        >
          {LABELS.apply}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !preview.editableHere}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await onBuildPackage({
                previewToken: preview.previewToken,
                decisions: decisionList,
                markdownOverride: paste.trim() || undefined,
              });
              if (!result.ok) {
                setError(result.message);
                return;
              }
              setPackageJson(result.packageJson);
              setMessage(LABELS.packageReady);
            })
          }
        >
          {LABELS.exportPackage}
        </Button>
      </div>
      {packageJson ? (
        <label>
          {LABELS.packageJson}
          <p className="small muted">{LABELS.packageHint}</p>
          <textarea className="mono" rows={12} readOnly value={packageJson} />
        </label>
      ) : null}
    </div>
  );
}
