"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { CharacterDevelopment } from "@/domain/characterDevelopment";
import {
  dismissHold,
  resolveHoldIntoField,
  updateHoldDecision,
  type DossierMarkdownArchive,
} from "@/domain/characterDossierUpgrade";
import { CHARACTER_MIGRATION_HOLD as LABELS } from "@/ui/labels";

export function MigrationHoldArchivePanel({
  projectId,
  recordId,
  profile,
  archive,
  archiveProblems,
  onChange,
}: {
  projectId: string;
  recordId: string;
  profile: CharacterDevelopment;
  archive: DossierMarkdownArchive;
  archiveProblems: string[];
  onChange: (profile: CharacterDevelopment) => void;
}) {
  const [openArchiveId, setOpenArchiveId] = useState<string | null>(null);
  const holds = profile.migrationHold;

  return (
    <div className="stack">
      <h3>{LABELS.heading}</h3>
      <p className="small muted">{LABELS.lead}</p>
      {archiveProblems.length ? (
        <Banner tone="warn">
          {LABELS.archiveWarning}: {archiveProblems.join(" ")}
        </Banner>
      ) : null}

      {holds.length === 0 ? (
        <p className="small muted">{LABELS.empty}</p>
      ) : (
        <div className="stack">
          {holds.map((item) => (
            <article key={item.id} className="panel" style={{ padding: "0.75rem" }}>
              <header className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <strong>
                  {item.kind.replaceAll("_", " ")} · {item.heading || item.fieldPath}
                </strong>
                <span className="small muted">
                  {item.decision === "deferred" ? LABELS.deferred : LABELS.retained}
                </span>
              </header>
              <p className="small muted">
                {LABELS.whyHeld}: {item.note || "Held from dossier upgrade for author review."}
              </p>
              <pre className="small" style={{ whiteSpace: "pre-wrap" }}>
                {item.text}
              </pre>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onChange(updateHoldDecision(profile, item.id, "retained"))}
                >
                  {LABELS.keepHold}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onChange(updateHoldDecision(profile, item.id, "deferred"))}
                >
                  {LABELS.deferHold}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const next = resolveHoldIntoField(profile, item.id);
                    if (next) onChange(next);
                  }}
                >
                  {LABELS.resolveDraft}
                </Button>
                <Button type="button" variant="danger" size="sm" onClick={() => onChange(dismissHold(profile, item.id))}>
                  {LABELS.dismiss}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>{LABELS.archiveHeading}</h3>
      {archive.entries.length === 0 ? (
        <p className="small muted">{LABELS.archiveEmpty}</p>
      ) : (
        <div className="stack">
          {archive.entries.map((entry) => (
            <article key={entry.id} className="panel" style={{ padding: "0.75rem" }}>
              <p className="small">
                {LABELS.archiveRevision(entry.sourceRevision)}
                {entry.archivedAt ? ` · ${LABELS.archiveAt} ${entry.archivedAt}` : ""}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setOpenArchiveId((current) => (current === entry.id ? null : entry.id))}
              >
                {openArchiveId === entry.id ? LABELS.hideBody : LABELS.viewBody}
              </Button>
              {openArchiveId === entry.id ? (
                <pre className="small" style={{ whiteSpace: "pre-wrap" }}>
                  {entry.body}
                </pre>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <ButtonLink
        href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}#history`}
        variant="secondary"
      >
        {LABELS.historyLink}
      </ButtonLink>
    </div>
  );
}
