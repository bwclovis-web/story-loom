"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Atoms/Button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import {
  RECORD_RELATION_KINDS,
  RECORD_RELATION_LABELS,
  type RecordRelationKind,
  type RecordRelationView,
} from "@/world/recordRelations";
import { RELATION_SCOPE_LABELS, type RelationScope } from "@/domain/assignments";
import { SERIES, WORLD } from "@/ui/labels";
import { addRecordRelationAction, removeRecordRelationAction } from "../recordRelationActions";

export function RecordRelations({
  projectId,
  recordId,
  outgoing,
  incoming,
  choices,
  canShareSeries = false,
}: {
  projectId: string;
  recordId: string;
  outgoing: RecordRelationView[];
  incoming: RecordRelationView[];
  choices: Array<{ id: string; title: string; typeLabel: string; homeLabel?: string | null }>;
  canShareSeries?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<RecordRelationKind>("member_of");
  const [customLabel, setCustomLabel] = useState("");
  const [toRecordId, setToRecordId] = useState("");
  const [scope, setScope] = useState<RelationScope>("book");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const base = `/projects/${encodeURIComponent(projectId)}/records`;
  const pickerChoices = choices.filter((c) => c.id !== recordId);

  return (
    <section className="panel" id="record-relations" aria-labelledby="record-relations-heading">
      <h2 id="record-relations-heading">{WORLD.recordRelations}</h2>
      <p className="small muted">{WORLD.recordRelationsNote}</p>
      <IssueList issues={issues} />

      <div className="stack" style={{ marginTop: "0.75rem" }}>
        <h3 className="small">{WORLD.recordRelationOutgoing}</h3>
        {outgoing.length === 0 ? (
          <p className="muted small">{WORLD.noRecordRelations}</p>
        ) : (
          <ul className="context-links">
            {outgoing.map((r) => (
              <li key={r.id} className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                <span>
                  {r.kindLabel}{" "}
                  <Link href={`${base}/${encodeURIComponent(r.toRecordId)}`}>{r.toTitle}</Link>
                  <span className="small muted">
                    {" "}
                    ({r.toTypeLabel}
                    {r.scope === "series" ? ` · ${SERIES.scopeWholeSeries}` : ` · ${SERIES.scopeThisBook}`})
                  </span>
                </span>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeRecordRelationAction(projectId, r.id, [r.fromRecordId, r.toRecordId]);
                      if (!result.ok) setIssues(result.issues);
                      else {
                        setIssues([]);
                        router.refresh();
                      }
                    })
                  }
                  variant="secondary"
                  size="sm"
                >
                  {WORLD.removeRecordRelation}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="small">{WORLD.recordRelationIncoming}</h3>
        {incoming.length === 0 ? (
          <p className="muted small">{WORLD.noRecordRelations}</p>
        ) : (
          <ul className="context-links">
            {incoming.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/${encodeURIComponent(r.fromRecordId)}`}>{r.fromTitle}</Link>
                <span className="small muted">
                  {" "}
                  {r.kindLabel.toLowerCase()} this record ({r.fromTypeLabel})
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="stack"
          style={{ gap: "0.5rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!toRecordId) return;
            startTransition(async () => {
              const result = await addRecordRelationAction(projectId, {
                fromRecordId: recordId,
                toRecordId,
                kind,
                customLabel: kind === "custom" ? customLabel : undefined,
                scope,
              });
              if (!result.ok) {
                setIssues(result.issues);
                return;
              }
              setIssues([]);
              setToRecordId("");
              setCustomLabel("");
              router.refresh();
            });
          }}
        >
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}>
            <label>
              {WORLD.relationKind}
              <select value={kind} onChange={(e) => setKind(e.target.value as RecordRelationKind)}>
                {RECORD_RELATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k === "custom" ? WORLD.recordRelationCustomKind : RECORD_RELATION_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {WORLD.recordRelationTo}
              <select value={toRecordId} onChange={(e) => setToRecordId(e.target.value)} required>
                <option value="">{WORLD.chooseRecordRelationTarget}</option>
                {pickerChoices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.typeLabel}
                    {c.homeLabel ? ` · ${c.homeLabel}` : ""})
                  </option>
                ))}
              </select>
            </label>
            {kind === "custom" ? (
              <label>
                {WORLD.recordRelationCustomLabel}
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  required
                  maxLength={64}
                />
              </label>
            ) : null}
            {canShareSeries ? (
              <label>
                Visibility
                <select value={scope} onChange={(e) => setScope(e.target.value as RelationScope)}>
                  <option value="book">{RELATION_SCOPE_LABELS.book}</option>
                  <option value="series">{RELATION_SCOPE_LABELS.series}</option>
                </select>
              </label>
            ) : null}
            <Button type="submit" disabled={pending || !toRecordId || (kind === "custom" && !customLabel.trim())} size="sm">
              {WORLD.addRecordRelation}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}