"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import {
  PLACE_RELATION_KINDS,
  PLACE_RELATION_LABELS,
  type PlaceRelationKind,
  type PlaceRelationView,
} from "@/server/services/placeRelationService";
import { WORLD } from "@/ui/labels";
import { addPlaceRelationAction, removePlaceRelationAction } from "../../world/maps/actions";

export function PlaceRelations({
  projectId,
  recordId,
  outgoing,
  incoming,
  choices,
}: {
  projectId: string;
  recordId: string;
  outgoing: PlaceRelationView[];
  incoming: PlaceRelationView[];
  choices: Array<{ id: string; title: string; typeLabel: string }>;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<PlaceRelationKind>("part_of");
  const [toRecordId, setToRecordId] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const base = `/projects/${encodeURIComponent(projectId)}/records`;

  return (
    <section className="panel" aria-labelledby="place-relations-heading">
      <h2 id="place-relations-heading">{WORLD.placeRelations}</h2>
      <p className="small muted">{WORLD.placeRelationsNote}</p>
      <IssueList issues={issues} />

      <div className="stack" style={{ marginTop: "0.75rem" }}>
        <h3 className="small">{WORLD.relationOutgoing}</h3>
        {outgoing.length === 0 ? (
          <p className="muted small">{WORLD.noPlaceRelations}</p>
        ) : (
          <ul className="context-links">
            {outgoing.map((r) => (
              <li key={r.id} className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
                <span>
                  {r.kindLabel}{" "}
                  <Link href={`${base}/${encodeURIComponent(r.toRecordId)}`}>{r.toTitle}</Link>
                  <span className="small muted"> ({r.toTypeLabel})</span>
                </span>
                <button
                  type="button"
                  className="secondary small-button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removePlaceRelationAction(projectId, r.id, [r.fromRecordId, r.toRecordId]);
                      if (!result.ok) setIssues(result.issues);
                      else {
                        setIssues([]);
                        router.refresh();
                      }
                    })
                  }
                >
                  {WORLD.removePlaceRelation}
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="small">{WORLD.relationIncoming}</h3>
        {incoming.length === 0 ? (
          <p className="muted small">{WORLD.noPlaceRelations}</p>
        ) : (
          <ul className="context-links">
            {incoming.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/${encodeURIComponent(r.fromRecordId)}`}>{r.fromTitle}</Link>
                <span className="small muted">
                  {" "}
                  {r.kindLabel.toLowerCase()} this place ({r.fromTypeLabel})
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="row"
          style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!toRecordId) return;
            startTransition(async () => {
              const result = await addPlaceRelationAction(projectId, {
                fromRecordId: recordId,
                toRecordId,
                kind,
              });
              if (!result.ok) {
                setIssues(result.issues);
                return;
              }
              setIssues([]);
              setToRecordId("");
              router.refresh();
            });
          }}
        >
          <label>
            {WORLD.relationKind}
            <select value={kind} onChange={(e) => setKind(e.target.value as PlaceRelationKind)}>
              {PLACE_RELATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PLACE_RELATION_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {WORLD.relationTo}
            <select value={toRecordId} onChange={(e) => setToRecordId(e.target.value)} required>
              <option value="">{WORLD.chooseRelatedPlace}</option>
              {choices
                .filter((c) => c.id !== recordId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.typeLabel})
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className="small-button" disabled={pending || !toRecordId}>
            {WORLD.addPlaceRelation}
          </button>
        </form>
      </div>
    </section>
  );
}
