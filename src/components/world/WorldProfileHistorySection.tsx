"use client";

import { useMemo, useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Atoms/Select";
import {
  NARRATIVE_BOUNDARIES,
  type NarrativeBoundary,
  type NarrativePoint,
} from "@/domain/characterDevelopment";
import { AUTHORITY_STATUSES, type AuthorityStatus } from "@/domain/statuses";
import type {
  WorldFieldHistoryChange,
  WorldProfile,
  WorldProfileFieldValue,
  WorldProfileQuantity,
  WorldQuantityQualifier,
} from "@/domain/worldProfile";
import { WORLD_QUANTITY_QUALIFIERS } from "@/domain/worldProfile";
import {
  appendWorldFieldChange,
  compareWorldFieldsAtPoints,
  resolveWorldFieldsAtPoint,
  supersedeWorldFieldChange,
  type WorldHistoryBookOrder,
} from "@/domain/worldProfileHistory";
import { WORLD_PROFILE } from "@/ui/labels";
import type { OrderEdge } from "@/world/storyOrder";
import type { WorldProfileDefinition, WorldProfileFieldDef } from "@/world/worldProfileRegistry";
import { getSubcategorySection } from "@/world/worldProfileRegistry";

export interface WorldHistoryCatalog {
  books: Array<{ id: string; label: string; narrativeIndex: number }>;
  events: Array<{ id: string; label: string; projectId: string }>;
  chapters: Array<{ id: string; label: string; projectId: string }>;
  scenes: Array<{ id: string; label: string; projectId: string }>;
  eventOrders: OrderEdge[];
}

const HISTORY_FIELD_TYPES = new Set([
  "short_text",
  "long_text",
  "quantity",
  "ordered_list",
  "number",
]);

function newHistoryId(): string {
  return `wfh_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function pointFromControls(input: {
  boundary: NarrativeBoundary;
  bookProjectId: string;
  storyEventId: string;
  chapterRecordId: string;
  sceneRecordId: string;
}): NarrativePoint {
  return {
    bookProjectId: input.bookProjectId || null,
    storyEventId: input.storyEventId || null,
    chapterRecordId: input.chapterRecordId || null,
    sceneRecordId: input.sceneRecordId || null,
    sequence: null,
    boundary: input.boundary,
  };
}

/** Parse free-text quantity history values such as "about 12,000" or "at least 500 km²". */
function parseHistoryQuantity(raw: string): WorldProfileQuantity | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(about|at\s+least|at\s+most|exact|approx\.?)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(.*)$/i);
  if (!match) return null;
  const qualifierRaw = (match[1] ?? "").toLowerCase().replace(/\s+/g, "_").replace(/\.$/, "");
  const qualifierMap: Record<string, WorldQuantityQualifier> = {
    about: "about",
    approx: "about",
    at_least: "at_least",
    at_most: "at_most",
    exact: "exact",
  };
  const amount = Number((match[2] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  const unit = (match[3] ?? "").trim().slice(0, 40);
  const quantity: WorldProfileQuantity = { amount };
  const qualifier = qualifierMap[qualifierRaw];
  if (qualifier && (WORLD_QUANTITY_QUALIFIERS as readonly string[]).includes(qualifier) && qualifier !== "exact") {
    quantity.qualifier = qualifier;
  }
  if (unit) quantity.unit = unit;
  return quantity;
}

function parseHistoryValue(field: WorldProfileFieldDef | null, raw: string): WorldProfileFieldValue {
  if (!field) return raw;
  if (field.type === "quantity") {
    return parseHistoryQuantity(raw) ?? (raw.trim() ? raw : null);
  }
  if (field.type === "ordered_list") {
    return raw
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 64);
  }
  if (field.type === "number") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const amount = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : raw;
  }
  return raw;
}

function findFieldDef(
  definition: WorldProfileDefinition | null,
  enabledSectionIds: readonly string[],
  fieldPath: string,
): WorldProfileFieldDef | null {
  const key = fieldPath.startsWith("values.")
    ? fieldPath.slice("values.".length)
    : fieldPath.startsWith("fields.")
      ? fieldPath.slice("fields.".length)
      : fieldPath;
  if (definition) {
    const found = definition.fields.find((field) => field.key === key);
    if (found) return found;
  }
  for (const sectionId of enabledSectionIds) {
    const section = getSubcategorySection(sectionId);
    const found = section?.fields.find((field) => field.key === key);
    if (found) return found;
  }
  return null;
}

function pushHistoryField(
  options: Array<{ path: string; label: string; storage: WorldFieldHistoryChange["storage"] }>,
  seen: Set<string>,
  field: WorldProfileFieldDef,
  labelPrefix = "",
) {
  if (!HISTORY_FIELD_TYPES.has(field.type)) return;
  if (field.storage === "flat") {
    const path = `fields.${field.key}`;
    if (seen.has(path)) return;
    seen.add(path);
    options.push({
      path,
      label: `${labelPrefix}${field.label} (Details)`,
      storage: "flat",
    });
    return;
  }
  if (field.storage === "profile") {
    const path = `values.${field.key}`;
    if (seen.has(path)) return;
    seen.add(path);
    options.push({
      path,
      label: `${labelPrefix}${field.label}`,
      storage: "profile",
    });
  }
}

function historyFieldOptions(
  definition: WorldProfileDefinition | null,
  enabledSectionIds: readonly string[] = [],
): Array<{ path: string; label: string; storage: WorldFieldHistoryChange["storage"] }> {
  const options: Array<{ path: string; label: string; storage: WorldFieldHistoryChange["storage"] }> = [
    { path: "summary", label: "Summary", storage: "summary" },
  ];
  const seen = new Set<string>(["summary"]);
  if (definition) {
    for (const field of definition.fields) {
      pushHistoryField(options, seen, field);
    }
  }
  for (const sectionId of enabledSectionIds) {
    const section = getSubcategorySection(sectionId);
    if (!section) continue;
    for (const field of section.fields) {
      pushHistoryField(options, seen, field, `${section.label}: `);
    }
  }
  return options;
}

export function WorldProfileHistorySection({
  profile,
  definition,
  enabledSectionIds = [],
  catalog,
  projectId,
  editable,
  pending,
  onProfileChange,
}: {
  profile: WorldProfile;
  definition: WorldProfileDefinition | null;
  enabledSectionIds?: readonly string[];
  catalog: WorldHistoryCatalog;
  projectId: string;
  editable: boolean;
  pending: boolean;
  onProfileChange: (next: WorldProfile) => void;
}) {
  const [boundary, setBoundary] = useState<NarrativeBoundary>("at_point");
  const [bookId, setBookId] = useState(projectId);
  const [storyEventId, setStoryEventId] = useState("");
  const [chapterRecordId, setChapterRecordId] = useState("");
  const [sceneRecordId, setSceneRecordId] = useState("");
  const [compareBoundary, setCompareBoundary] = useState<NarrativeBoundary>("baseline");
  const [compareBookId, setCompareBookId] = useState(projectId);
  const [showCompare, setShowCompare] = useState(false);

  const fieldOptions = useMemo(
    () => historyFieldOptions(definition, enabledSectionIds),
    [definition, enabledSectionIds],
  );
  const [fieldPath, setFieldPath] = useState(fieldOptions[0]?.path ?? "values.access");
  const [presence, setPresence] = useState<"set" | "unknown">("set");
  const [valueText, setValueText] = useState("");
  const [approval, setApproval] = useState<AuthorityStatus>("draft");
  const [planned, setPlanned] = useState(false);
  const [worldScope, setWorldScope] = useState<"book" | "series">("series");
  const [note, setNote] = useState("");
  const [calendarLabel, setCalendarLabel] = useState("");
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionNote, setCorrectionNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const books: WorldHistoryBookOrder = catalog.books.map((book) => ({
    projectId: book.id,
    narrativeIndex: book.narrativeIndex,
  }));
  const edges = catalog.eventOrders;
  const point = pointFromControls({ boundary, bookProjectId: bookId, storyEventId, chapterRecordId, sceneRecordId });
  const comparePoint = pointFromControls({
    boundary: compareBoundary,
    bookProjectId: compareBookId,
    storyEventId: "",
    chapterRecordId: "",
    sceneRecordId: "",
  });
  const trackPaths = fieldOptions.map((item) => item.path);
  const resolved = resolveWorldFieldsAtPoint(profile, point, edges, {
    books,
    viewingProjectId: projectId,
    fieldPaths: trackPaths,
  });
  const comparison = showCompare
    ? compareWorldFieldsAtPoints(profile, comparePoint, point, edges, {
        books,
        viewingProjectId: projectId,
        fieldPaths: trackPaths,
      })
    : null;

  const selectedOption = fieldOptions.find((item) => item.path === fieldPath) ?? fieldOptions[0];
  const selectedFieldDef = findFieldDef(definition, enabledSectionIds, selectedOption?.path ?? fieldPath);

  const addChange = () => {
    setLocalError(null);
    if (!selectedOption) {
      setLocalError("Choose a field to record.");
      return;
    }
    const change: WorldFieldHistoryChange = {
      id: newHistoryId(),
      fieldPath: selectedOption.path,
      definitionId: profile.definitionId,
      storage: selectedOption.storage,
      presence,
      value: presence === "unknown" ? null : parseHistoryValue(selectedFieldDef, valueText),
      approval,
      planned,
      provenance: { origin: "author", note: "" },
      bookProjectId: bookId || null,
      storyEventId: storyEventId || null,
      chapterRecordId: chapterRecordId || null,
      sceneRecordId: sceneRecordId || null,
      sequence: null,
      worldScope,
      note,
      supersedesId: null,
      correctionNote: "",
      correctedAt: null,
    };
    if (calendarLabel.trim()) change.calendarLabel = calendarLabel.trim();
    onProfileChange(appendWorldFieldChange(profile, change));
    setValueText("");
    setNote("");
    setCalendarLabel("");
    setApproval("draft");
    setPlanned(false);
  };

  const applyCorrection = () => {
    setLocalError(null);
    if (!correctingId) return;
    const prior = profile.fieldHistory.find((change) => change.id === correctingId);
    if (!prior) {
      setLocalError("Prior change not found.");
      return;
    }
    const result = supersedeWorldFieldChange(
      profile,
      correctingId,
      {
        fieldPath: prior.fieldPath,
        definitionId: prior.definitionId ?? profile.definitionId,
        storage: prior.storage,
        presence: "set",
        value: correctionText,
        approval: "draft",
        planned: false,
        provenance: { origin: "author", note: "" },
        bookProjectId: prior.bookProjectId,
        storyEventId: prior.storyEventId,
        chapterRecordId: prior.chapterRecordId,
        sceneRecordId: prior.sceneRecordId,
        sequence: prior.sequence,
        worldScope: prior.worldScope,
        note: prior.note,
        correctionNote: correctionNote || `Corrects ${correctingId}`,
        correctedAt: null,
      },
      () => newHistoryId(),
    );
    if (!result.ok) {
      setLocalError(result.message);
      return;
    }
    onProfileChange(result.profile);
    setCorrectingId(null);
    setCorrectionText("");
    setCorrectionNote("");
  };

  const eventsForBook = catalog.events.filter((item) => !bookId || item.projectId === bookId);
  const chaptersForBook = catalog.chapters.filter((item) => !bookId || item.projectId === bookId);
  const scenesForBook = catalog.scenes.filter((item) => !bookId || item.projectId === bookId);

  return (
    <details className="stack" open={profile.fieldHistory.length > 0}>
      <summary>{WORLD_PROFILE.history}</summary>
      <p className="small muted">{WORLD_PROFILE.historyLead}</p>
      {profile.fieldHistory.length === 0 ? <EmptyState>{WORLD_PROFILE.historyEmpty}</EmptyState> : null}
      <p className="small muted">{WORLD_PROFILE.flatHistoryNote}</p>

      <div className="grid2">
        <Select
          label={WORLD_PROFILE.asOf}
          size="sm"
          value={boundary}
          onChange={(event) => setBoundary(event.target.value as NarrativeBoundary)}
        >
          {NARRATIVE_BOUNDARIES.map((item) => (
            <option key={item} value={item}>
              {WORLD_PROFILE.stateBoundaries[item]}
            </option>
          ))}
        </Select>
        <Select label="Book" size="sm" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          {catalog.books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.label}
            </option>
          ))}
        </Select>
        {boundary === "at_point" ? (
          <>
            <label>
              Timeline event
              <select value={storyEventId} onChange={(event) => setStoryEventId(event.target.value)}>
                <option value="">—</option>
                {eventsForBook.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chapter
              <select value={chapterRecordId} onChange={(event) => setChapterRecordId(event.target.value)}>
                <option value="">—</option>
                {chaptersForBook.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scene
              <select value={sceneRecordId} onChange={(event) => setSceneRecordId(event.target.value)}>
                <option value="">—</option>
                {scenesForBook.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      <div className="stack">
        <p className="small">{WORLD_PROFILE.effectiveValue}</p>
        <ul className="stack">
          {trackPaths.map((path) => {
            const value = resolved.fields[path] ?? { presence: "unknown" as const };
            const label = fieldOptions.find((item) => item.path === path)?.label ?? path;
            return (
              <li key={path} className="small">
                <strong>{label}</strong>:{" "}
                {value.presence === "unknown"
                  ? WORLD_PROFILE.unknownAtPoint
                  : value.formatted}
                {value.presence === "set" ? (
                  <span className="muted"> · {WORLD_PROFILE.sourceChange} {value.changeId}</span>
                ) : value.changeId ? (
                  <span className="muted"> · {WORLD_PROFILE.sourceChange} {value.changeId}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {resolved.conflicts.length ? (
          <Banner tone="error">
            {WORLD_PROFILE.conflictsAtPoint}: {resolved.conflicts.map((item) => item.fieldPath).join(", ")}
          </Banner>
        ) : null}
        {resolved.unplacedChangeIds.length ? (
          <p className="small muted">
            {WORLD_PROFILE.unplacedChanges}: {resolved.unplacedChangeIds.join(", ")}
          </p>
        ) : null}
      </div>

      <fieldset className="stack">
        <legend>{WORLD_PROFILE.comparePoints}</legend>
        <Select
          label={WORLD_PROFILE.compareFrom}
          size="sm"
          value={compareBoundary}
          onChange={(event) => setCompareBoundary(event.target.value as NarrativeBoundary)}
        >
          {NARRATIVE_BOUNDARIES.map((item) => (
            <option key={item} value={item}>
              {WORLD_PROFILE.stateBoundaries[item]}
            </option>
          ))}
        </Select>
        <Select label="Book" size="sm" value={compareBookId} onChange={(event) => setCompareBookId(event.target.value)}>
          {catalog.books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.label}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" onClick={() => setShowCompare(true)}>
          {WORLD_PROFILE.runComparison}
        </Button>
        {comparison ? (
          comparison.diffs.every((diff) => diff.kind === "unchanged") ? (
            <EmptyState>{WORLD_PROFILE.noHistoryDiffs}</EmptyState>
          ) : (
            <ul className="small">
              {comparison.diffs
                .filter((diff) => diff.kind !== "unchanged")
                .map((diff) => (
                  <li key={diff.fieldPath}>
                    {diff.fieldPath}: {diff.kind}
                    {diff.to.presence === "set"
                      ? ` → ${diff.to.formatted}`
                      : diff.to.presence === "unknown"
                        ? ` → ${WORLD_PROFILE.unknownAtPoint}`
                        : ""}
                  </li>
                ))}
            </ul>
          )
        ) : null}
      </fieldset>

      {editable ? (
        <>
          {localError ? <Banner tone="error">{localError}</Banner> : null}
          <fieldset className="stack" disabled={pending}>
            <legend>{WORLD_PROFILE.recordChange}</legend>
            <label>
              {WORLD_PROFILE.fieldPath}
              <select value={fieldPath} onChange={(event) => setFieldPath(event.target.value)}>
                {fieldOptions.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {WORLD_PROFILE.presence}
              <select
                value={presence}
                onChange={(event) => setPresence(event.target.value as "set" | "unknown")}
              >
                <option value="set">{WORLD_PROFILE.presenceSet}</option>
                <option value="unknown">{WORLD_PROFILE.presenceUnknown}</option>
              </select>
            </label>
            {presence === "set" ? (
              <label>
                {WORLD_PROFILE.changeValue}
                <input value={valueText} onChange={(event) => setValueText(event.target.value)} />
              </label>
            ) : null}
            <label>
              {WORLD_PROFILE.changeApproval}
              <select
                value={approval}
                onChange={(event) => setApproval(event.target.value as AuthorityStatus)}
              >
                {AUTHORITY_STATUSES.filter((status) => status !== "superseded").map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline">
              <input type="checkbox" checked={planned} onChange={(event) => setPlanned(event.target.checked)} />{" "}
              {WORLD_PROFILE.plannedChange}
            </label>
            <label>
              {WORLD_PROFILE.worldScope}
              <select
                value={worldScope}
                onChange={(event) => setWorldScope(event.target.value as "book" | "series")}
              >
                <option value="series">{WORLD_PROFILE.worldScopeSeries}</option>
                <option value="book">{WORLD_PROFILE.worldScopeBook}</option>
              </select>
            </label>
            <label>
              {WORLD_PROFILE.calendarLabel}
              <input value={calendarLabel} onChange={(event) => setCalendarLabel(event.target.value)} />
            </label>
            <label>
              {WORLD_PROFILE.note}
              <input value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <Button type="button" variant="secondary" onClick={addChange}>
              {WORLD_PROFILE.addChange}
            </Button>
          </fieldset>

          <fieldset className="stack" disabled={pending}>
            <legend>{WORLD_PROFILE.correction}</legend>
            <label>
              {WORLD_PROFILE.priorChange}
              <select
                value={correctingId ?? ""}
                onChange={(event) => setCorrectingId(event.target.value || null)}
              >
                <option value="">—</option>
                {profile.fieldHistory
                  .filter((change) => change.approval !== "superseded")
                  .map((change) => (
                    <option key={change.id} value={change.id}>
                      {change.fieldPath}: {change.presence === "unknown" ? "unknown" : String(change.value ?? "")} (
                      {change.id})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {WORLD_PROFILE.changeValue}
              <input value={correctionText} onChange={(event) => setCorrectionText(event.target.value)} />
            </label>
            <label>
              {WORLD_PROFILE.correctionNote}
              <input value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} />
            </label>
            <Button type="button" variant="secondary" disabled={!correctingId} onClick={applyCorrection}>
              {WORLD_PROFILE.applyCorrection}
            </Button>
          </fieldset>
        </>
      ) : null}

      {profile.fieldHistory.length ? (
        <details>
          <summary>
            All dated changes ({profile.fieldHistory.length})
          </summary>
          <ul className="small">
            {profile.fieldHistory.map((change) => (
              <li key={change.id}>
                {change.fieldPath} · {change.presence === "unknown" ? "unknown" : String(change.value ?? "")} ·{" "}
                {change.approval}
                {change.planned ? " · planned" : ""} · {change.worldScope}
                {change.calendarLabel ? ` · ${change.calendarLabel}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}
