"use client";
import { Button } from "@/components/ui/Button";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import {
  WEAVE_VIEW_KINDS,
  WEAVE_VIEW_LABELS,
  type WeaveTemplateView,
  type WeaveViewKind,
} from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import {
  applyWeaveTemplateAction,
  createWeaveTemplateAction,
  deleteWeaveTemplateAction,
  upsertWeaveTemplateBeatAction,
} from "../actions";

export function TemplatesClient({
  projectId,
  initial,
}: {
  projectId: string;
  initial: WeaveTemplateView[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const [applyKind, setApplyKind] = useState<Record<string, WeaveViewKind>>({});

  return (
    <>
      <IssueList issues={issues} />
      <section className="panel" aria-labelledby="new-template">
        <h2 id="new-template">{WEAVE.newTemplate}</h2>
        <form
          className="row"
          style={{ flexWrap: "wrap", gap: "0.5rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await createWeaveTemplateAction(projectId, { title });
              if (!result.ok) {
                setIssues(result.issues);
                return;
              }
              setTitle("");
              setIssues([]);
              router.refresh();
            });
          }}
        >
          <label>
            {WEAVE.templateTitle}
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <Button type="submit" disabled={pending}>
            {WEAVE.createTemplate}
          </Button>
        </form>
      </section>

      {initial.length === 0 ? (
        <p className="muted">{WEAVE.noTemplates}</p>
      ) : (
        initial.map((t) => (
          <section key={t.id} className="panel" aria-labelledby={`tmpl-${t.id}`}>
            <h2 id={`tmpl-${t.id}`}>{t.title}</h2>
            {t.description ? <p className="small muted">{t.description}</p> : null}
            <p className="small muted">{WEAVE.beatsCount(t.beats.length)}</p>
            <ul className="stack">
              {t.beats.map((b) => (
                <li key={b.id} className="small">
                  {b.title}
                  {b.decision ? ` · ${b.decision}` : ""}
                </li>
              ))}
            </ul>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
              <Button
                type="button"
               
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await upsertWeaveTemplateBeatAction(projectId, t.id, {
                      title: `Beat ${t.beats.length + 1}`,
                      x: 40 + t.beats.length * 24,
                      y: 40 + t.beats.length * 24,
                    });
                    if (!result.ok) setIssues(result.issues);
                    else router.refresh();
                  })
                }
               variant="secondary" size="sm">
                {WEAVE.addBeat}
              </Button>
              <label>
                {WEAVE.applyAsView}
                <select
                  value={applyKind[t.id] ?? "original"}
                  onChange={(e) => setApplyKind((m) => ({ ...m, [t.id]: e.target.value as WeaveViewKind }))}
                >
                  {WEAVE_VIEW_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {WEAVE_VIEW_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
               
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await applyWeaveTemplateAction(projectId, t.id, {
                      viewKind: applyKind[t.id] ?? "original",
                    });
                    if (!result.ok) {
                      setIssues(result.issues);
                      return;
                    }
                    router.push(
                      `/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(result.gridId)}`,
                    );
                  })
                }
               size="sm">
                {WEAVE.applyTemplate}
              </Button>
              <Button
                type="button"
               
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteWeaveTemplateAction(projectId, t.id);
                    if (!result.ok) setIssues(result.issues);
                    else router.refresh();
                  })
                }
               variant="secondary" size="sm">
                {WEAVE.deleteTemplate}
              </Button>
            </div>
          </section>
        ))
      )}
    </>
  );
}
