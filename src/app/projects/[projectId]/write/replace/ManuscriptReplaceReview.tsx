"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { ManuscriptReplaceMatch, ManuscriptReplacePreview } from "@/server/services/manuscriptReplaceService";
import { MANUSCRIPT_REPLACE, RECORD } from "@/ui/labels";
import { applyManuscriptReplaceAction, type ReplaceFormResult } from "./actions";

function groupMatches(matches: readonly ManuscriptReplaceMatch[]) {
  const map = new Map<string, ManuscriptReplaceMatch[]>();
  for (const m of matches) {
    map.set(m.recordId, [...(map.get(m.recordId) ?? []), m]);
  }
  return map;
}

export function ManuscriptReplaceReview({
  projectId,
  preview,
  base,
}: {
  projectId: string;
  preview: ManuscriptReplacePreview;
  base: string;
}) {
  const allIds = useMemo(() => preview.matches.map((m) => m.id), [preview.matches]);
  const [selected, setSelected] = useState(() => new Set(allIds));
  const needsUnlock = preview.matches.some((m) => m.protected && selected.has(m.id));
  const [state, formAction, pending] = useActionState(applyManuscriptReplaceAction.bind(null, projectId), {
    ok: true,
  } satisfies ReplaceFormResult);

  const grouped = groupMatches(preview.matches);
  const selectedCount = preview.matches.filter((m) => selected.has(m.id)).length;

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (on: boolean) => {
    setSelected(on ? new Set(allIds) : new Set());
  };

  return (
    <section className="panel" aria-labelledby="manuscript-replace-review">
      <h2 id="manuscript-replace-review">{MANUSCRIPT_REPLACE.reviewHeading}</h2>
      <p className="small muted">{MANUSCRIPT_REPLACE.reviewLead(selectedCount, preview.matches.length)}</p>

      <form action={formAction} className="stack">
        <input type="hidden" name="find" value={preview.find} />
        <input type="hidden" name="replace" value={preview.replace} />
        {preview.matchCase ? <input type="hidden" name="matchCase" value="on" /> : null}
        {preview.wholeWord ? <input type="hidden" name="wholeWord" value="on" /> : null}
        {preview.regex ? <input type="hidden" name="regex" value="on" /> : null}
        {[...grouped.entries()].map(([recordId, matches]) => (
          <input key={recordId} type="hidden" name={`rev_${recordId}`} value={String(matches[0]!.expectedRevision)} />
        ))}

        <div className="row small">
          <Button type="button" variant="secondary" size="sm" onClick={() => toggleAll(true)}>
            {MANUSCRIPT_REPLACE.selectAll}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => toggleAll(false)}>
            {MANUSCRIPT_REPLACE.selectNone}
          </Button>
        </div>

        {preview.matches.length === 0 ? <p className="muted">{MANUSCRIPT_REPLACE.noMatches}</p> : null}

        <ul className="search-hits">
          {[...grouped.entries()].map(([recordId, matches]) => (
            <li key={recordId}>
              <div className="row">
                <Link href={`${base}/records/${encodeURIComponent(recordId)}`} className="hit-title">
                  {matches[0]!.recordTitle}
                </Link>
                <span className="small muted">
                  {RECORD_TYPE_LABELS[matches[0]!.recordType]}
                  {matches[0]!.parentTitle ? ` ${MANUSCRIPT_REPLACE.inParent(matches[0]!.parentTitle)}` : ""}
                </span>
                {matches[0]!.protected ? <span className="small muted">{MANUSCRIPT_REPLACE.protected}</span> : null}
              </div>
              <ul className="hit-excerpts small">
                {matches.map((m) => (
                  <li key={m.id} className="stack">
                    <label className="inline">
                      <input
                        type="checkbox"
                        name="matchId"
                        value={m.id}
                        checked={selected.has(m.id)}
                        onChange={(e) => toggle(m.id, e.target.checked)}
                      />{" "}
                      <span className="muted">{m.field === "title" ? MANUSCRIPT_REPLACE.inTitle : MANUSCRIPT_REPLACE.inBody}</span>
                    </label>
                    <div className="small">
                      <del>{m.excerptBefore}</del>
                      <ins>{m.excerptAfter}</ins>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {needsUnlock ? (
          <label className="inline small">
            <input type="checkbox" name="unlockProtected" required disabled={pending} /> {RECORD.unlockProtected}
          </label>
        ) : null}

        <div className="row">
          <Button type="submit" disabled={pending || selectedCount === 0}>
            {pending ? MANUSCRIPT_REPLACE.applying : MANUSCRIPT_REPLACE.apply(selectedCount)}
          </Button>
          <ButtonLink href={`${base}/write/replace`} variant="secondary">
            {MANUSCRIPT_REPLACE.newSearch}
          </ButtonLink>
        </div>

        {state.message ? (
          <Banner tone={state.ok ? "ok" : "error"} className="mb-0">
            {state.message}
          </Banner>
        ) : null}
        <IssueList issues={state.issues ?? []} />
      </form>
    </section>
  );
}