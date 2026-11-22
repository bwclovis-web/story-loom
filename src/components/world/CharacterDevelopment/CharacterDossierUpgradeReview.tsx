"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  CharacterDossierUpgradePreview,
  ApplyDossierUpgradeResult,
} from "@/server/services/characterDossierUpgradeService";
import type { DossierUpgradeDecisionInput, UpgradeDecision } from "@/domain/characterDossierUpgrade";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { CHARACTER_DOSSIER_UPGRADE as LABELS } from "@/ui/labels";

type DecisionState = Record<string, { decision: UpgradeDecision; modifiedValue: string }>;

function defaultDecisions(preview: CharacterDossierUpgradePreview): DecisionState {
  const state: DecisionState = {};
  for (const item of preview.analysis.items) {
    state[item.id] = {
      decision: item.alreadyApplied ? "defer" : item.requiresHumanReview ? "defer" : "accept",
      modifiedValue: item.proposedValue,
    };
  }
  return state;
}

export function CharacterDossierUpgradeReview({
  projectId,
  initial,
  onPreview,
  onApply,
  onBuildPackage,
  importMode = false,
}: {
  projectId: string;
  initial: CharacterDossierUpgradePreview;
  onPreview: (markdownOverride?: string) => Promise<
    { ok: true; preview: CharacterDossierUpgradePreview } | { ok: false; message: string }
  >;
  onApply: (input: {
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    unlockProtected: boolean;
    markdownOverride?: string;
  }) => Promise<ApplyDossierUpgradeResult | { status: "failed"; message: string }>;
  onBuildPackage: (input: {
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    markdownOverride?: string;
  }) => Promise<{ ok: true; packageJson: string } | { ok: false; message: string }>;
  importMode?: boolean;
}) {
  const [preview, setPreview] = useState(initial);
  const [decisions, setDecisions] = useState<DecisionState>(() => defaultDecisions(initial));
  const [unlockProtected, setUnlockProtected] = useState(false);
  const [paste, setPaste] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packageJson, setPackageJson] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decisionList = useMemo((): DossierUpgradeDecisionInput[] => {
    return preview.analysis.items.map((item) => {
      const row = decisions[item.id] ?? { decision: "defer" as const, modifiedValue: item.proposedValue };
      return {
        itemId: item.id,
        decision: row.decision,
        modifiedValue: row.decision === "modify" ? row.modifiedValue : undefined,
      };
    });
  }, [preview, decisions]);

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
        markdownOverride: importMode && paste.trim() ? paste : undefined,
      });
      if (result.status === "applied") {
        setMessage(LABELS.applied(result.appliedItemIds.length, result.deferredItemIds.length));
        const refreshed = await onPreview(importMode && paste.trim() ? paste : undefined);
        if (refreshed.ok) {
          setPreview(refreshed.preview);
          setDecisions(defaultDecisions(refreshed.preview));
        }
        return;
      }
      if (result.status === "already_applied") {
        setMessage(LABELS.alreadyApplied);
        return;
      }
      const issues = "issues" in result ? result.issues : [];
      const failedMessage = "message" in result ? result.message : undefined;
      setError(
        issues.some((issue) => issue.code === "STALE_PREVIEW")
          ? LABELS.stale
          : issues.map((issue) => issue.message).join(" ") || failedMessage || LABELS.rejected,
      );
    });

  const runPackage = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await onBuildPackage({
        previewToken: preview.previewToken,
        decisions: decisionList,
        markdownOverride: importMode && paste.trim() ? paste : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPackageJson(result.packageJson);
      setMessage(LABELS.packageReady);
    });

  return (
    <div className="stack">
      <p className="small muted">{LABELS.lead}</p>
      <p className="small muted">{LABELS.authorityNote}</p>
      {preview.issues.length ? (
        <Banner tone="error">{preview.issues.map((issue) => issue.message).join(" ")}</Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="ok">{message}</Banner> : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <Button type="button" disabled={pending} onClick={() => runPreview()}>
          {LABELS.preview}
        </Button>
        <ButtonLink href={`/projects/${encodeURIComponent(projectId)}/world/development/upgrade`}>
          {LABELS.projectReview}
        </ButtonLink>
        <ButtonLink href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(preview.recordId)}#character-development`}>
          {LABELS.backToProfile}
        </ButtonLink>
      </div>

      {importMode ? (
        <label className="stack">
          {LABELS.pasteMarkdown}
          <textarea
            rows={8}
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            placeholder={LABELS.pastePlaceholder}
          />
          <Button type="button" disabled={pending || !paste.trim()} onClick={() => runPreview(paste)}>
            {LABELS.analyzePaste}
          </Button>
        </label>
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
      {preview.alreadyMigrated ? <Banner>{LABELS.alreadyMigrated}</Banner> : null}

      <div className="stack">
        {preview.analysis.items.map((item) => {
          const row = decisions[item.id] ?? { decision: "defer" as const, modifiedValue: item.proposedValue };
          return (
            <article key={item.id} className="panel" style={{ padding: "0.75rem" }}>
              <header className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <strong>
                  {LABELS.destination(item.destination)} → {item.fieldPath}
                </strong>
                <span className="small muted">
                  {item.requiresHumanReview ? LABELS.needsReview : LABELS.ready} · {item.classificationConfidence}
                </span>
              </header>
              <p className="small muted">
                {LABELS.sourceHeading}: {item.sourceHeading}
              </p>
              <p className="small">
                <strong>{LABELS.sourceText}</strong>
              </p>
              <pre className="small" style={{ whiteSpace: "pre-wrap" }}>
                {item.sourceExcerpt}
              </pre>
              {item.existingCanonical ? (
                <>
                  <p className="small">
                    <strong>{LABELS.existingCanonical}</strong>
                  </p>
                  <pre className="small" style={{ whiteSpace: "pre-wrap" }}>
                    {item.existingCanonical}
                  </pre>
                </>
              ) : (
                <p className="small muted">{LABELS.noExisting}</p>
              )}
              <p className="small">
                {LABELS.authority}: {item.authorityHint}
                {item.conflictWithIds.length ? ` · ${LABELS.conflicts}` : ""}
                {item.duplicateOfIds.length ? ` · ${LABELS.duplicates}` : ""}
                {item.supersedesIds.length ? ` · ${LABELS.supersedes}` : ""}
                {item.alreadyApplied ? ` · ${LABELS.itemAlreadyApplied}` : ""}
              </p>
              {item.reviewReasons.length ? (
                <ul className="small">
                  {item.reviewReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
              <label>
                {LABELS.decision}
                <select
                  value={row.decision}
                  onChange={(event) =>
                    setDecisions((prev) => ({
                      ...prev,
                      [item.id]: { ...row, decision: event.target.value as UpgradeDecision },
                    }))
                  }
                >
                  <option value="accept">{LABELS.accept}</option>
                  <option value="modify">{LABELS.modify}</option>
                  <option value="reject">{LABELS.reject}</option>
                  <option value="defer">{LABELS.defer}</option>
                </select>
              </label>
              {row.decision === "modify" ? (
                <label className="stack">
                  {LABELS.modifiedValue}
                  <textarea
                    rows={4}
                    value={row.modifiedValue}
                    onChange={(event) =>
                      setDecisions((prev) => ({
                        ...prev,
                        [item.id]: { ...row, modifiedValue: event.target.value },
                      }))
                    }
                  />
                </label>
              ) : null}
            </article>
          );
        })}
      </div>

      {preview.protected ? (
        <Checkbox
          checked={unlockProtected}
          onChange={(event) => setUnlockProtected(event.target.checked)}
          label={LABELS.unlockProtected}
        />
      ) : null}

      <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <Button type="button" disabled={pending || preview.issues.length > 0} onClick={runApply}>
          {LABELS.apply}
        </Button>
        <Button type="button" variant="secondary" disabled={pending || preview.issues.length > 0} onClick={runPackage}>
          {LABELS.exportPackage}
        </Button>
      </div>

      {packageJson ? (
        <label className="stack">
          {LABELS.packageJson}
          <textarea rows={12} readOnly value={packageJson} />
          <p className="small muted">{LABELS.packageHint}</p>
        </label>
      ) : null}
    </div>
  );
}
