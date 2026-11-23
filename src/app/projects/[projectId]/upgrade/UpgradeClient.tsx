"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DRAFT_KIND_LABELS,
  DRAFT_KINDS,
  WORLD_SCOPE_LABELS,
  WORLD_SCOPES,
  type DraftKind,
  type WorldScope,
} from "@/domain/assignments";
import type { AssignmentPlan, AssignmentPreview, ManuscriptGroupInput } from "@/server/services/assignmentService";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { UPGRADE } from "@/ui/labels";
import { applyAssignmentsAction, previewAssignmentsAction } from "./actions";

type GroupDraft = {
  key: string;
  id?: string;
  label: string;
  draftKind: DraftKind | "";
  chapterIds: string[];
};

function groupsFromPreview(preview: AssignmentPreview): GroupDraft[] {
  return preview.plan.groups.map((g, i) => ({
    key: g.id || `new-${i}`,
    id: g.id,
    label: g.label,
    draftKind: g.draftKind ?? "",
    chapterIds: [...g.chapterIds],
  }));
}

function worldMapFromPreview(preview: AssignmentPreview): Record<string, WorldScope | ""> {
  const map: Record<string, WorldScope | ""> = {};
  for (const w of preview.worldRecords) {
    const planned = preview.plan.worldScopes.find((s) => s.recordId === w.id);
    map[w.id] = planned?.scope ?? w.scope ?? "";
  }
  return map;
}

export function UpgradeClient({ projectId, initial }: { projectId: string; initial: AssignmentPreview }) {
  const [seriesName, setSeriesName] = useState(initial.plan.seriesName ?? "");
  const [bookName, setBookName] = useState(initial.plan.bookName ?? "");
  const [draftKind, setDraftKind] = useState<DraftKind | "">(initial.plan.draftKind ?? "");
  const [groups, setGroups] = useState<GroupDraft[]>(() => groupsFromPreview(initial));
  const [worldScopes, setWorldScopes] = useState<Record<string, WorldScope | "">>(() => worldMapFromPreview(initial));
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const assigned = useMemo(() => new Set(groups.flatMap((g) => g.chapterIds)), [groups]);
  const ungrouped = initial.chapters.filter((c) => !assigned.has(c.id));

  const buildProposal = () => ({
    seriesName,
    bookName,
    draftKind: draftKind || null,
    groups: groups.map(
      (g, i): ManuscriptGroupInput => ({
        id: g.id,
        label: g.label,
        position: i,
        draftKind: g.draftKind || null,
        chapterIds: g.chapterIds,
      }),
    ),
    worldScopes: Object.entries(worldScopes).map(([recordId, scope]) => ({
      recordId,
      scope: scope || null,
    })),
  });

  const runPreview = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await previewAssignmentsAction(projectId, buildProposal());
      if (!result.ok) {
        setError(result.issues.map((i) => i.message).join(" "));
        setPreview(null);
        return;
      }
      if (result.preview.issues.length) {
        setError(result.preview.issues.map((i) => i.message).join(" "));
        setPreview(null);
        return;
      }
      setPreview(result.preview);
      setGroups(groupsFromPreview(result.preview));
      setWorldScopes(worldMapFromPreview(result.preview));
      setSeriesName(result.preview.plan.seriesName ?? "");
      setBookName(result.preview.plan.bookName ?? "");
      setDraftKind(result.preview.plan.draftKind ?? "");
    });

  const runApply = () => {
    if (!preview) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await applyAssignmentsAction(projectId, {
        plan: preview.plan,
        previewToken: preview.previewToken,
      });
      if (result.status === "applied") {
        setMessage(UPGRADE.applied);
        setPreview(null);
        return;
      }
      if (result.status === "already_applied") {
        setMessage(UPGRADE.alreadyApplied);
        setPreview(null);
        return;
      }
      const issues = "issues" in result ? result.issues : [];
      setError(issues.some((i) => i.code === "STALE_PREVIEW") ? UPGRADE.stale : issues.map((i) => i.message).join(" ") || UPGRADE.rejected);
      setPreview(null);
    });
  };

  const addGroup = () =>
    setGroups((prev) => [...prev, { key: `draft-${Date.now()}`, label: "", draftKind: "", chapterIds: [] }]);

  const toggleChapter = (groupKey: string, chapterId: string, on: boolean) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.key === groupKey) {
          const chapterIds = on ? [...g.chapterIds, chapterId] : g.chapterIds.filter((id) => id !== chapterId);
          return { ...g, chapterIds };
        }
        if (on) return { ...g, chapterIds: g.chapterIds.filter((id) => id !== chapterId) };
        return g;
      }),
    );
  };

  if (preview) {
    return (
      <div className="stack">
        <div className="panel stack">
          <h2>{UPGRADE.previewHeading}</h2>
          <p className="muted">{UPGRADE.previewNote}</p>
          <PreviewSummary plan={preview.plan} changes={preview.changes} />
          <div className="row">
            <button type="button" className="primary" disabled={pending || preview.changes.noEffectiveChange} onClick={runApply}>
              {pending ? UPGRADE.applying : UPGRADE.apply}
            </button>
            <button type="button" className="link-button" disabled={pending} onClick={() => setPreview(null)}>
              {UPGRADE.changePreview}
            </button>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {message ? <p className="ok">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack">
      {message ? <p className="ok">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="panel stack">
        <label>
          {UPGRADE.seriesName}
          <input value={seriesName} onChange={(e) => setSeriesName(e.target.value)} autoComplete="off" />
        </label>
        <label>
          {UPGRADE.bookName}
          <input value={bookName} onChange={(e) => setBookName(e.target.value)} autoComplete="off" />
        </label>
        <label>
          {UPGRADE.draftKind}
          <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as DraftKind | "")}>
            <option value="">{UPGRADE.draftNone}</option>
            {DRAFT_KINDS.map((k) => (
              <option key={k} value={k}>
                {DRAFT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel stack">
        <h2>{UPGRADE.groupsHeading}</h2>
        <p className="muted small">{UPGRADE.groupsIntro}</p>
        {initial.chapters.length === 0 ? <p className="muted">{UPGRADE.noChapters}</p> : null}
        {groups.map((g) => (
          <div key={g.key} className="stack border-block">
            <div className="row">
              <label className="grow">
                {UPGRADE.groupLabel}
                <input
                  value={g.label}
                  onChange={(e) => setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, label: e.target.value } : x)))}
                  autoComplete="off"
                />
              </label>
              <label>
                {UPGRADE.groupDraft}
                <select
                  value={g.draftKind}
                  onChange={(e) =>
                    setGroups((prev) =>
                      prev.map((x) => (x.key === g.key ? { ...x, draftKind: e.target.value as DraftKind | "" } : x)),
                    )
                  }
                >
                  <option value="">{UPGRADE.draftNone}</option>
                  {DRAFT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {DRAFT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="link-button"
                onClick={() => setGroups((prev) => prev.filter((x) => x.key !== g.key))}
              >
                {UPGRADE.removeGroup}
              </button>
            </div>
            <ul className="check-list">
              {initial.chapters.map((c) => {
                const checked = g.chapterIds.includes(c.id);
                const taken = !checked && assigned.has(c.id);
                return (
                  <li key={c.id}>
                    <Checkbox
                      className={taken ? "muted" : undefined}
                      checked={checked}
                      disabled={taken}
                      onChange={(e) => toggleChapter(g.key, c.id, e.target.checked)}
                      label={c.title}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <button type="button" onClick={addGroup}>
          {UPGRADE.addGroup}
        </button>
        {ungrouped.length > 0 ? (
          <p className="muted small">
            {UPGRADE.ungrouped}: {ungrouped.map((c) => c.title).join(", ")}
          </p>
        ) : null}
      </div>

      <div className="panel stack">
        <h2>{UPGRADE.worldHeading}</h2>
        <p className="muted small">{UPGRADE.worldIntro}</p>
        {initial.worldRecords.length === 0 ? (
          <p className="muted">{UPGRADE.noWorld}</p>
        ) : (
          <ul className="stack">
            {initial.worldRecords.map((w) => (
              <li key={w.id} className="row">
                <span className="grow">
                  {w.title} <span className="muted small">({w.type})</span>
                </span>
                <select
                  aria-label={`${w.title} scope`}
                  value={worldScopes[w.id] ?? ""}
                  onChange={(e) => setWorldScopes((prev) => ({ ...prev, [w.id]: e.target.value as WorldScope | "" }))}
                >
                  <option value="">{UPGRADE.worldNone}</option>
                  {WORLD_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {WORLD_SCOPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row">
        <button type="button" className="primary" disabled={pending} onClick={runPreview}>
          {pending ? UPGRADE.previewing : UPGRADE.preview}
        </button>
      </div>
    </div>
  );
}

function PreviewSummary({
  plan,
  changes,
}: {
  plan: AssignmentPlan;
  changes: AssignmentPreview["changes"];
}) {
  return (
    <dl className="summary-list">
      <dt>{UPGRADE.summarySeries}</dt>
      <dd>{plan.seriesName ?? UPGRADE.none}</dd>
      <dt>{UPGRADE.summaryBook}</dt>
      <dd>{plan.bookName ?? UPGRADE.none}</dd>
      <dt>{UPGRADE.summaryDraft}</dt>
      <dd>{plan.draftKind ? DRAFT_KIND_LABELS[plan.draftKind] : UPGRADE.none}</dd>
      <dt>{UPGRADE.summaryGroups}</dt>
      <dd>
        {plan.groups.length === 0
          ? UPGRADE.none
          : plan.groups.map((g) => `${g.label} (${g.chapterIds.length} chapter${g.chapterIds.length === 1 ? "" : "s"})`).join("; ")}
      </dd>
      <dt>{UPGRADE.summaryWorld}</dt>
      <dd>{changes.worldScopeChanges}</dd>
    </dl>
  );
}
