"use client";

import { useMemo, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Select } from "@/components/ui/Atoms/Select";
import type { Issue } from "@/domain/issues";
import { TAXONOMY_ORGANIZE } from "@/ui/labels";
import { taxonomyPlacementLabel } from "@/ui/world";
import {
  getTaxonomyCategory,
  WORLD_TAXONOMY_CATEGORIES,
  type TaxonomyPlacement,
} from "@/world/taxonomy";
import type { TaxonomyOperation, TaxonomyPreview, TaxonomyView } from "@/server/services/taxonomyOrganizeService";
import { applyBulkTaxonomyAction, previewBulkTaxonomyAction } from "./actions";

export interface OrganizeRecordRow {
  id: string;
  title: string;
  typeLabel: string;
  protected: boolean;
  primary: TaxonomyPlacement | null;
  inferred: boolean;
  secondary: TaxonomyPlacement[];
  tags: string[];
}

type PrimaryMode = "keep" | "set" | "clear";

interface PlacementDraft {
  category: string;
  subcategory: string;
}

const EMPTY_PLACEMENT: PlacementDraft = { category: "", subcategory: "" };

function toPlacement(draft: PlacementDraft): TaxonomyPlacement | null {
  if (!draft.category) return null;
  return draft.subcategory ? { category: draft.category, subcategory: draft.subcategory } : { category: draft.category };
}

function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function describeView(view: {
  primary: TaxonomyPlacement | null;
  inferred: boolean;
  secondary: TaxonomyPlacement[];
  tags: string[];
}): string {
  const parts: string[] = [];
  if (view.primary) {
    parts.push(`${taxonomyPlacementLabel(view.primary)}${view.inferred ? " (from type or kind)" : ""}`);
  }
  if (view.secondary.length) parts.push(`also ${view.secondary.map(taxonomyPlacementLabel).join(", ")}`);
  if (view.tags.length) parts.push(`tags ${view.tags.join(", ")}`);
  return parts.length ? parts.join("; ") : TAXONOMY_ORGANIZE.unclassified;
}

function PlacementPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: PlacementDraft;
  onChange: (next: PlacementDraft) => void;
  disabled?: boolean;
}) {
  const subs = getTaxonomyCategory(value.category)?.subcategories ?? [];
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
      <Select
        label={label}
        value={value.category}
        disabled={disabled}
        onChange={(event) => onChange({ category: event.target.value, subcategory: "" })}
      >
        <option value="">—</option>
        {WORLD_TAXONOMY_CATEGORIES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
      <Select
        label="Subcategory"
        value={value.subcategory}
        disabled={disabled || !value.category}
        onChange={(event) => onChange({ ...value, subcategory: event.target.value })}
      >
        <option value="">—</option>
        {subs.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * Multi-select list of this book's World references with one classification
 * change. Preview shows each record before and after; Apply saves one new
 * revision per changed record, all or nothing.
 */
export function BulkOrganizeClient({ projectId, records }: { projectId: string; records: readonly OrganizeRecordRow[] }) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [primaryMode, setPrimaryMode] = useState<PrimaryMode>("keep");
  const [primary, setPrimary] = useState<PlacementDraft>(EMPTY_PLACEMENT);
  const [addSecondary, setAddSecondary] = useState<PlacementDraft>(EMPTY_PLACEMENT);
  const [removeSecondary, setRemoveSecondary] = useState<PlacementDraft>(EMPTY_PLACEMENT);
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState("");
  const [clearAll, setClearAll] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const [previewState, setPreviewState] = useState<{ key: string; preview: TaxonomyPreview } | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = filter.normalize("NFC").trim().toLocaleLowerCase();
  const shown = useMemo(
    () => records.filter((record) => !needle || record.title.normalize("NFC").toLocaleLowerCase().includes(needle)),
    [records, needle],
  );
  const recordIds = useMemo(() => records.filter((record) => selected.has(record.id)).map((record) => record.id), [records, selected]);

  const operation = useMemo<TaxonomyOperation>(() => {
    if (clearAll) return { clearTaxonomy: true };
    const next: TaxonomyOperation = {};
    if (primaryMode === "clear") next.setPrimary = null;
    if (primaryMode === "set") {
      const placement = toPlacement(primary);
      if (placement) next.setPrimary = placement;
    }
    const add = toPlacement(addSecondary);
    if (add) next.addSecondary = [add];
    const remove = toPlacement(removeSecondary);
    if (remove) next.removeSecondary = [remove];
    const tagsToAdd = splitTags(addTags);
    if (tagsToAdd.length) next.addTags = tagsToAdd;
    const tagsToRemove = splitTags(removeTags);
    if (tagsToRemove.length) next.removeTags = tagsToRemove;
    return next;
  }, [clearAll, primaryMode, primary, addSecondary, removeSecondary, addTags, removeTags]);

  const hasOperation = Object.keys(operation).length > 0;
  const key = JSON.stringify({ recordIds, operation });
  // A preview describes one selection and one change. Any edit makes it stale.
  const preview = previewState && previewState.key === key ? previewState.preview : null;
  const titleOf = (id: string) => records.find((record) => record.id === id)?.title ?? id;

  const blocking =
    !!preview &&
    (preview.ineligible.length > 0 ||
      preview.conflicts.some((item) => item.severity === "error") ||
      !!preview.operationProblem);
  const needsUnlock = !!preview && preview.protectedRecordIds.length > 0 && !unlock;
  const canApply = !!preview && !blocking && preview.changedCount > 0 && !needsUnlock;

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const runPreview = () => {
    setMessage(null);
    setIssues([]);
    startTransition(async () => {
      const result = await previewBulkTaxonomyAction(projectId, { recordIds, operation, unlockProtected: unlock });
      if (result.ok) setPreviewState({ key, preview: result.preview });
      else {
        setPreviewState(null);
        setIssues(result.issues);
      }
    });
  };

  const runApply = () => {
    if (!preview) return;
    setMessage(null);
    setIssues([]);
    startTransition(async () => {
      const result = await applyBulkTaxonomyAction(projectId, {
        recordIds,
        operation,
        unlockProtected: unlock,
        expectedRevisions: preview.revisions,
      });
      if (result.ok) {
        setPreviewState(null);
        setUnlock(false);
        setMessage({
          tone: result.updatedCount ? "ok" : "info",
          text: result.updatedCount ? TAXONOMY_ORGANIZE.applied(result.updatedCount) : TAXONOMY_ORGANIZE.appliedNone,
        });
      } else {
        setIssues(result.issues);
      }
    });
  };

  return (
    <div className="stack bulk-organize">
      <section className="panel stack" aria-labelledby="organize-select-heading">
        <h2 id="organize-select-heading">{TAXONOMY_ORGANIZE.selectHeading}</h2>
        <p className="small muted">{TAXONOMY_ORGANIZE.selectHint}</p>
        {records.length === 0 ? (
          <p className="muted">{TAXONOMY_ORGANIZE.noRecords}</p>
        ) : (
          <>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
              <label>
                {TAXONOMY_ORGANIZE.filterLabel}
                <input type="text" value={filter} onChange={(event) => setFilter(event.target.value)} />
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSelected((current) => new Set([...current, ...shown.map((record) => record.id)]))}
              >
                {TAXONOMY_ORGANIZE.selectAll}
              </Button>
              <Button type="button" variant="secondary" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
                {TAXONOMY_ORGANIZE.selectNone}
              </Button>
              <span className="small muted" role="status">
                {TAXONOMY_ORGANIZE.selectedCount(recordIds.length)}
              </span>
            </div>
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {shown.map((record) => (
                <li key={record.id}>
                  <Checkbox
                    checked={selected.has(record.id)}
                    onChange={(event) => toggle(record.id, event.target.checked)}
                    label={
                      <>
                        <strong>{record.title}</strong>{" "}
                        <span className="small muted">
                          {record.typeLabel}
                          {record.protected ? " · Protected" : ""} · {describeView(record)}
                        </span>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel stack" aria-labelledby="organize-change-heading">
        <h2 id="organize-change-heading">{TAXONOMY_ORGANIZE.operationHeading}</h2>
        <p className="small muted">{TAXONOMY_ORGANIZE.revisionNote}</p>
        <RadioGroup
          legend={TAXONOMY_ORGANIZE.setPrimary}
          name="organizePrimaryMode"
          value={primaryMode}
          layout="stack"
          onValueChange={(value) => setPrimaryMode(value === "set" || value === "clear" ? value : "keep")}
          options={[
            { value: "keep", label: TAXONOMY_ORGANIZE.setPrimaryNoChange, disabled: clearAll },
            { value: "set", label: TAXONOMY_ORGANIZE.setPrimary, disabled: clearAll },
            { value: "clear", label: TAXONOMY_ORGANIZE.setPrimaryClear, disabled: clearAll },
          ]}
        />
        {primaryMode === "set" ? (
          <PlacementPicker label="Category" value={primary} onChange={setPrimary} disabled={clearAll} />
        ) : null}
        <PlacementPicker label={TAXONOMY_ORGANIZE.addSecondary} value={addSecondary} onChange={setAddSecondary} disabled={clearAll} />
        <PlacementPicker
          label={TAXONOMY_ORGANIZE.removeSecondary}
          value={removeSecondary}
          onChange={setRemoveSecondary}
          disabled={clearAll}
        />
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <label>
            {TAXONOMY_ORGANIZE.addTags}
            <input type="text" value={addTags} disabled={clearAll} onChange={(event) => setAddTags(event.target.value)} />
          </label>
          <label>
            {TAXONOMY_ORGANIZE.removeTags}
            <input type="text" value={removeTags} disabled={clearAll} onChange={(event) => setRemoveTags(event.target.value)} />
          </label>
        </div>
        <p className="small muted">{TAXONOMY_ORGANIZE.tagsHint}</p>
        <Checkbox checked={clearAll} onChange={(event) => setClearAll(event.target.checked)} label={TAXONOMY_ORGANIZE.clearTaxonomy} />
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <Button type="button" disabled={pending || recordIds.length === 0 || !hasOperation} onClick={runPreview}>
            {TAXONOMY_ORGANIZE.preview}
          </Button>
          <Button type="button" variant="secondary" disabled={pending || !canApply} onClick={runApply}>
            {pending ? TAXONOMY_ORGANIZE.applying : TAXONOMY_ORGANIZE.apply}
          </Button>
        </div>
        {recordIds.length === 0 ? <p className="small muted">{TAXONOMY_ORGANIZE.noSelection}</p> : null}
        {!hasOperation ? <p className="small muted">{TAXONOMY_ORGANIZE.noOperation}</p> : null}
      </section>

      {message ? <Banner tone={message.tone === "ok" ? "ok" : "info"}>{message.text}</Banner> : null}
      <IssueList issues={issues} />

      {preview ? (
        <section className="panel stack" aria-labelledby="organize-preview-heading">
          <h2 id="organize-preview-heading">{TAXONOMY_ORGANIZE.previewHeading}</h2>
          {preview.operationProblem ? <Banner tone="error">{preview.operationProblem}</Banner> : null}
          {preview.ineligible.length ? (
            <Banner tone="error">
              <ul>
                {preview.ineligible.map((item) => (
                  <li key={item.recordId}>
                    {titleOf(item.recordId)}: {item.reason}
                  </li>
                ))}
              </ul>
            </Banner>
          ) : null}
          {preview.protectedRecordIds.length ? (
            <div className="stack">
              <h3 className="small">{TAXONOMY_ORGANIZE.protectedHeading}</h3>
              <Banner tone="info">{TAXONOMY_ORGANIZE.protectedNote(preview.protectedRecordIds.length)}</Banner>
              <ul className="small">
                {preview.protectedRecordIds.map((id) => (
                  <li key={id}>{titleOf(id)}</li>
                ))}
              </ul>
              <Checkbox checked={unlock} onChange={(event) => setUnlock(event.target.checked)} label={TAXONOMY_ORGANIZE.unlockProtected} />
            </div>
          ) : null}
          {preview.conflicts.length ? (
            <div className="stack">
              <h3 className="small">{TAXONOMY_ORGANIZE.conflictsHeading}</h3>
              <ul className="small">
                {preview.conflicts.map((conflict, index) => (
                  <li key={`${conflict.recordId}:${conflict.kind}:${index}`}>
                    <strong>{titleOf(conflict.recordId)}</strong>: {conflict.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="md-table-wrap" tabIndex={0} role="region" aria-label={TAXONOMY_ORGANIZE.previewHeading}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">{TAXONOMY_ORGANIZE.before}</th>
                  <th scope="col">{TAXONOMY_ORGANIZE.after}</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((item) => (
                  <tr key={item.recordId}>
                    <th scope="row">
                      {item.title}
                      {item.protected ? <span className="badge"> Protected</span> : null}
                    </th>
                    <td>{describeView(item.before as TaxonomyView)}</td>
                    <td>{item.changed ? describeView(item.after as TaxonomyView) : <span className="muted">{TAXONOMY_ORGANIZE.unchanged}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
