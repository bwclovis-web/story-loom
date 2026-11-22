"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createManuscriptAction } from "@/app/projects/[projectId]/write/actions";
import { Button } from "@/components/ui/Button";
import { TreeSearch } from "@/components/ui/SearchPanel";
import type { Issue } from "@/domain/issues";
import { NAV, WRITE } from "@/ui/labels";
import { buildManuscriptTree, chapterOf, filterManuscriptTree, type TreeScene } from "@/ui/manuscriptTree";
import type { RecordNavEntry } from "@/ui/navigation";
import { ChevronRightIcon, PlusIcon, SceneDocIcon } from "./icons";
import { confirmLeave } from "./unsaved";

export function ManuscriptTree({
  projectId,
  records,
  currentRecordId,
  draftId = null,
}: {
  projectId: string;
  records: RecordNavEntry[];
  currentRecordId: string | null;
  /** Active Write draft; new chapters/scenes join this draft when set. */
  draftId?: string | null;
}) {
  const idPrefix = useId();
  const base = `/projects/${encodeURIComponent(projectId)}/records/`;
  const tree = useMemo(() => buildManuscriptTree(records), [records]);
  const currentChapter = useMemo(() => chapterOf(records, currentRecordId), [records, currentRecordId]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(currentChapter ? [currentChapter] : []));
  const [creating, setCreating] = useState<"chapter" | "scene" | null>(null);

  // Opening a scene from elsewhere reveals it in the tree.
  useEffect(() => {
    if (currentChapter) setExpanded((prev) => (prev.has(currentChapter) ? prev : new Set(prev).add(currentChapter)));
  }, [currentChapter]);

  const searching = query.trim() !== "";
  const shown = useMemo(() => filterManuscriptTree(tree, query), [tree, query]);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sceneItem = (s: TreeScene) => {
    const current = s.id === currentRecordId;
    return (
      <li key={s.id}>
        <Link href={base + encodeURIComponent(s.id)} className="tree-link scene" aria-current={current ? "page" : undefined} title={s.title}>
          <SceneDocIcon />
          <span className="tree-scene-title">{s.title}</span>
        </Link>
      </li>
    );
  };

  return (
    <section className="manuscript-tree" aria-labelledby={`${idPrefix}-heading`}>
      <div className="tree-head">
        <p className="nav-subheading" id={`${idPrefix}-heading`}>
          {WRITE.chapterList}
        </p>
        <div className="tree-actions">
          <Button
            type="button"
            variant="secondary" size="sm"
            aria-expanded={creating === "chapter"}
            aria-controls={`${idPrefix}-create`}
            onClick={() => setCreating(creating === "chapter" ? null : "chapter")}
          >
            <PlusIcon />
            {WRITE.newChapter}
          </Button>
          <Button
            type="button"
            variant="secondary" size="sm"
            aria-expanded={creating === "scene"}
            aria-controls={`${idPrefix}-create`}
            onClick={() => setCreating(creating === "scene" ? null : "scene")}
          >
            <PlusIcon />
            {WRITE.newScene}
          </Button>
        </div>
      </div>

      <div id={`${idPrefix}-create`}>
        {creating ? (
          <ManuscriptCreateForm
            key={creating}
            kind={creating}
            projectId={projectId}
            chapters={tree.chapters}
            defaultChapter={currentChapter}
            draftId={draftId}
            onDone={() => setCreating(null)}
          />
        ) : null}
      </div>

      <p className="tree-links">
        <Link href={`/projects/${encodeURIComponent(projectId)}/read`}>{NAV.readBook}</Link>
        <Link href={`/projects/${encodeURIComponent(projectId)}/import-chapters`}>{NAV.importChapters}</Link>
      </p>

      <TreeSearch
        action={`/projects/${encodeURIComponent(projectId)}/write`}
        label={WRITE.searchManuscript}
        value={query}
        onChange={setQuery}
        hint={WRITE.searchHint}
        hintId={`${idPrefix}-search-hint`}
      />
      <p className="sr-only" role="status">
        {searching ? (shown.matchCount ? WRITE.matches(shown.matchCount) : WRITE.noMatches) : ""}
      </p>

      {tree.chapters.length === 0 && tree.unplaced.length === 0 ? (
        <p className="nav-empty">{WRITE.noChapters}</p>
      ) : searching && shown.chapters.length === 0 && shown.unplaced.length === 0 ? (
        <p className="nav-empty">{WRITE.noMatches}</p>
      ) : (
        <ul className="tree" aria-labelledby={`${idPrefix}-heading`}>
          {shown.chapters.map((c) => {
            const open = searching || expanded.has(c.id);
            const listId = `${idPrefix}-${c.id}`;
            const current = c.id === currentRecordId;
            return (
              <li key={c.id}>
                <div className="tree-row">
                  {c.scenes.length ? (
                    <button
                      type="button"
                      className="tree-toggle"
                      aria-expanded={open}
                      aria-controls={listId}
                      aria-label={open ? WRITE.hideScenes(c.title) : WRITE.showScenes(c.title)}
                      disabled={searching}
                      onClick={() => toggle(c.id)}
                    >
                      <ChevronRightIcon />
                    </button>
                  ) : (
                    <span className="tree-toggle-spacer" aria-hidden="true" />
                  )}
                  <Link
                    href={base + encodeURIComponent(c.id)}
                    className="tree-link chapter"
                    aria-current={current ? "page" : undefined}
                    title={c.title}
                  >
                    {c.title}
                  </Link>
                  {c.scenes.length ? (
                    <span className="nav-count" aria-label={WRITE.scenes(c.scenes.length)}>
                      {c.scenes.length}
                    </span>
                  ) : null}
                </div>
                {c.scenes.length ? (
                  <ul id={listId} className="tree-scenes" hidden={!open}>
                    {c.scenes.map(sceneItem)}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {shown.unplaced.length ? (
            <li>
              <p className="tree-unplaced">{WRITE.unplaced}</p>
              <ul className="tree-scenes">{shown.unplaced.map(sceneItem)}</ul>
            </li>
          ) : null}
        </ul>
      )}
      <p className="tree-note">{WRITE.orderNote}</p>
    </section>
  );
}

export function ManuscriptCreateForm({
  kind,
  projectId,
  chapters,
  defaultChapter,
  draftId,
  onDone,
}: {
  kind: "chapter" | "scene";
  projectId: string;
  chapters: { id: string; title: string }[];
  defaultChapter: string | null;
  draftId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const idPrefix = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);

  useEffect(() => titleRef.current?.focus(), []);

  if (kind === "scene" && chapters.length === 0) {
    return (
      <div className="tree-create">
        <p className="hint">{WRITE.needsChapter}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {WRITE.cancel}
        </Button>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!confirmLeave()) return;
    setPending(true);
    const result = await createManuscriptAction(projectId, {
      kind,
      title: String(data.get("title") ?? ""),
      parentRecordId: kind === "scene" ? String(data.get("chapter") ?? "") : undefined,
      draftId,
    });
    setPending(false);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    onDone();
    router.push(`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(result.recordId)}`);
  }

  return (
    <form
      className="tree-create stack"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
      aria-label={kind === "chapter" ? WRITE.newChapter : WRITE.newScene}
    >
      <label>
        {WRITE.titleLabel}
        <input ref={titleRef} type="text" name="title" required />
      </label>
      {kind === "scene" ? (
        <label>
          {WRITE.chapterLabel}
          <select name="chapter" defaultValue={defaultChapter ?? chapters[0].id}>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {issues.length ? (
        <ul className="issues" id={`${idPrefix}-issues`}>
          {issues.map((i, n) => (
            <li key={n} className="issue error">
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? WRITE.creating : WRITE.create}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {WRITE.cancel}
        </Button>
      </div>
    </form>
  );
}
