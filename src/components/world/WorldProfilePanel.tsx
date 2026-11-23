"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { TextField } from "@/components/ui/TextField";
import type { WorldProfile, WorldProfileFieldValue } from "@/domain/worldProfile";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  worldFieldMetaOf,
} from "@/domain/worldProfile";
import { SERIES, WORLD_PROFILE } from "@/ui/labels";
import type { WorldProfileDefinition, WorldProfileFieldDef } from "@/world/worldProfileRegistry";
import { seriesBookLabel, type SeriesHomeRef } from "@/world/seriesHome";
import {
  WorldProfileHistorySection,
  type WorldHistoryCatalog,
} from "@/components/world/WorldProfileHistorySection";

function listTextValue(value: WorldProfileFieldValue): string {
  if (Array.isArray(value)) return value.join("\n");
  return formatWorldProfileFieldValue(value);
}

function parseListText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 64);
}

function fieldEditorValue(field: WorldProfileFieldDef, value: WorldProfileFieldValue): string {
  if (field.type === "calendar_date") {
    if (value && typeof value === "object" && !Array.isArray(value) && "freeText" in value) {
      return typeof value.freeText === "string" ? value.freeText : formatWorldProfileFieldValue(value);
    }
    return formatWorldProfileFieldValue(value);
  }
  if (field.type === "record_ref") {
    if (value && typeof value === "object" && !Array.isArray(value) && "recordId" in value) {
      return value.recordId;
    }
    return "";
  }
  if (field.type === "ordered_list" || field.type === "multi_select" || field.type === "record_refs") {
    return listTextValue(value);
  }
  if (field.type === "boolean") {
    if (value === true) return "true";
    if (value === false) return "false";
    return "";
  }
  if (field.type === "number") {
    return typeof value === "number" ? String(value) : "";
  }
  return typeof value === "string" ? value : formatWorldProfileFieldValue(value);
}

function parseFieldEditorValue(field: WorldProfileFieldDef, raw: string): WorldProfileFieldValue {
  const trimmed = raw.trim();
  switch (field.type) {
    case "boolean":
      if (raw === "true") return true;
      if (raw === "false") return false;
      return null;
    case "number":
      if (trimmed === "") return null;
      return Number(raw);
    case "calendar_date":
      return trimmed ? { freeText: trimmed.slice(0, 200) } : null;
    case "record_ref":
      return trimmed ? { recordId: trimmed.slice(0, 80) } : null;
    case "ordered_list":
    case "multi_select":
    case "record_refs":
      return parseListText(raw);
    default:
      return raw;
  }
}

export function WorldProfilePanel({
  projectId,
  recordId,
  revision,
  body,
  profile: initialProfile,
  definition,
  definitions,
  plausibleDefinitions = [],
  editable,
  seriesHome,
  isProtected,
  historyCatalog,
  onSave,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  body: string;
  profile: WorldProfile | null;
  definition: WorldProfileDefinition | null;
  definitions: readonly WorldProfileDefinition[];
  plausibleDefinitions?: readonly WorldProfileDefinition[];
  editable: boolean;
  seriesHome: SeriesHomeRef | null;
  isProtected: boolean;
  historyCatalog: WorldHistoryCatalog;
  onSave: (input: {
    expectedRevision: number;
    profile: WorldProfile;
    unlockProtected: boolean;
  }) => Promise<{ ok: true; revision: number } | { ok: false; message: string }>;
}) {
  const [profile, setProfile] = useState<WorldProfile>(initialProfile ?? emptyWorldProfile());
  const [unlockProtected, setUnlockProtected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [bodyOpen, setBodyOpen] = useState(false);

  const activeDefinition = useMemo(() => {
    if (profile.definitionId) {
      return (
        definitions.find((item) => item.id === profile.definitionId) ??
        plausibleDefinitions.find((item) => item.id === profile.definitionId) ??
        definition
      );
    }
    return definition;
  }, [definition, definitions, plausibleDefinitions, profile.definitionId]);

  const profileFields = useMemo(
    () => (activeDefinition?.fields ?? []).filter((field) => field.storage === "profile"),
    [activeDefinition],
  );
  const flatNoteFields = useMemo(
    () => (activeDefinition?.fields ?? []).filter((field) => field.storage === "flat"),
    [activeDefinition],
  );
  const approvedCount = useMemo(
    () => Object.values(profile.fieldMeta).filter((meta) => meta.approval === "approved").length,
    [profile.fieldMeta],
  );
  const needsChoice = !profile.definitionId && plausibleDefinitions.length > 1 && !activeDefinition;
  const plausibleIds = useMemo(() => new Set(plausibleDefinitions.map((item) => item.id)), [plausibleDefinitions]);
  const otherDefinitions = useMemo(
    () => definitions.filter((item) => !plausibleIds.has(item.id)),
    [definitions, plausibleIds],
  );

  const upgradeHref = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}/world-upgrade`;
  const homeHref = seriesHome
    ? `/projects/${encodeURIComponent(seriesHome.projectId)}/records/${encodeURIComponent(recordId)}`
    : null;

  const save = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await onSave({
        expectedRevision: revision,
        profile,
        unlockProtected,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(WORLD_PROFILE.saved);
    });

  return (
    <section className="panel stack" id="world-profile" aria-labelledby="world-profile-heading">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h2 id="world-profile-heading">{WORLD_PROFILE.heading}</h2>
          <p className="small muted">{WORLD_PROFILE.lead}</p>
        </div>
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          {editable ? (
            <ButtonLink href={upgradeHref} variant="secondary">
              {WORLD_PROFILE.openUpgrade}
            </ButtonLink>
          ) : homeHref ? (
            <ButtonLink href={`${homeHref}/world-upgrade`} variant="secondary">
              {WORLD_PROFILE.editInHome(seriesBookLabel(seriesHome!))}
            </ButtonLink>
          ) : null}
        </div>
      </div>

      {seriesHome ? (
        <p className="small muted">
          {SERIES.sharedFrom(seriesBookLabel(seriesHome))}
          {editable ? null : ` ${WORLD_PROFILE.editInHome(seriesBookLabel(seriesHome))}`}
        </p>
      ) : null}

      <p className="small muted">
        {WORLD_PROFILE.optionalNote}{" "}
        {approvedCount ? WORLD_PROFILE.approvedCount(approvedCount) : null}
        {profile.migrationHold.length ? ` · ${WORLD_PROFILE.holdCount(profile.migrationHold.length)}` : null}
      </p>

      {message ? <Banner tone="ok">{message}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {needsChoice ? <Banner>{WORLD_PROFILE.chooseDefinition}</Banner> : null}

      <label>
        {WORLD_PROFILE.definition}
        <select
          value={profile.definitionId ?? ""}
          disabled={!editable || pending}
          onChange={(event) =>
            setProfile((current) => ({
              ...current,
              definitionId: event.target.value || null,
            }))
          }
        >
          <option value="">{WORLD_PROFILE.definitionNone}</option>
          {plausibleDefinitions.length ? (
            <optgroup label={WORLD_PROFILE.plausibleHeading}>
              {plausibleDefinitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.homeLabel ? ` (${item.homeLabel})` : ""}
                </option>
              ))}
            </optgroup>
          ) : null}
          {otherDefinitions.length ? (
            <optgroup label={WORLD_PROFILE.otherDefinitions}>
              {otherDefinitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.homeLabel ? ` (${item.homeLabel})` : ""}
                </option>
              ))}
            </optgroup>
          ) : null}
          {!plausibleDefinitions.length && !otherDefinitions.length
            ? definitions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.homeLabel ? ` (${item.homeLabel})` : ""}
                </option>
              ))
            : null}
        </select>
      </label>

      <TextField
        label={WORLD_PROFILE.summary}
        value={profile.summary}
        disabled={!editable || pending}
        onChange={(event) => setProfile((current) => ({ ...current, summary: event.target.value }))}
      />

      {flatNoteFields.length ? (
        <p className="small muted">
          {WORLD_PROFILE.flatFieldsNote}{" "}
          {flatNoteFields.map((field) => field.label).join(", ")}.
        </p>
      ) : null}

      {profileFields.length ? (
        <div className="stack">
          <h3 className="small">{WORLD_PROFILE.values}</h3>
          {profileFields.map((field) => {
            const raw = profile.values[field.key] ?? null;
            const value = fieldEditorValue(field, raw);
            const meta = worldFieldMetaOf(profile, `values.${field.key}`);
            const listLike =
              field.type === "long_text" ||
              field.multiline ||
              field.type === "ordered_list" ||
              field.type === "multi_select" ||
              field.type === "record_refs";
            return (
              <label key={field.key}>
                {field.label}
                {field.description ? <span className="small muted"> — {field.description}</span> : null}
                {listLike ? (
                  <textarea
                    rows={field.type === "long_text" || field.multiline ? 3 : 2}
                    value={value}
                    disabled={!editable || pending}
                    placeholder={
                      field.placeholder ??
                      (field.type === "ordered_list" || field.type === "record_refs" || field.type === "multi_select"
                        ? "One item per line"
                        : undefined)
                    }
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          [field.key]: parseFieldEditorValue(field, event.target.value),
                        },
                      }))
                    }
                  />
                ) : field.type === "boolean" ? (
                  <select
                    value={value}
                    disabled={!editable || pending}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          [field.key]: parseFieldEditorValue(field, event.target.value),
                        },
                      }))
                    }
                  >
                    <option value="">—</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : "text"}
                    value={value}
                    disabled={!editable || pending}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        values: {
                          ...current.values,
                          [field.key]: parseFieldEditorValue(field, event.target.value),
                        },
                      }))
                    }
                  />
                )}
                <span className="small muted">
                  {WORLD_PROFILE.approval}: {meta.approval} · {WORLD_PROFILE.provenance}: {meta.provenance.origin}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="small muted">{WORLD_PROFILE.empty}</p>
      )}

      {activeDefinition?.collections.length ? (
        <div className="stack">
          <h3 className="small">{WORLD_PROFILE.collections}</h3>
          {activeDefinition.collections.map((collection) => {
            const items = profile.collections[collection.key] ?? [];
            return (
              <div key={collection.key} className="stack">
                <strong className="small">{collection.label}</strong>
                {items.length ? (
                  <ul>
                    {items.map((item) => (
                      <li key={item.id} className="small">
                        {Object.entries(item.fields)
                          .map(([key, entry]) => `${key}: ${formatWorldProfileFieldValue(entry)}`)
                          .join("; ") || "(empty)"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="small muted">—</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <details>
        <summary>{WORLD_PROFILE.holds}</summary>
        {profile.migrationHold.length ? (
          <ul>
            {profile.migrationHold.map((hold) => (
              <li key={hold.id} className="small">
                <strong>{hold.heading || hold.kind}</strong>: {hold.text.slice(0, 200)}
                {hold.text.length > 200 ? "…" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{WORLD_PROFILE.holdsEmpty}</p>
        )}
      </details>

      <WorldProfileHistorySection
        profile={profile}
        definition={activeDefinition}
        catalog={historyCatalog}
        projectId={projectId}
        editable={editable}
        pending={pending}
        onProfileChange={setProfile}
      />

      <details open={bodyOpen} onToggle={(event) => setBodyOpen(event.currentTarget.open)}>
        <summary>{WORLD_PROFILE.originalMarkdown}</summary>
        <p className="small muted">{WORLD_PROFILE.showBody}</p>
        <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>
          {body || "(empty)"}
        </pre>
      </details>

      {editable ? (
        <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          {isProtected ? (
            <label className="inline">
              <input
                type="checkbox"
                checked={unlockProtected}
                onChange={(event) => setUnlockProtected(event.target.checked)}
              />{" "}
              Unlock protected reference for this save
            </label>
          ) : null}
          <Button type="button" disabled={pending || (isProtected && !unlockProtected)} onClick={save}>
            {WORLD_PROFILE.save}
          </Button>
          <ButtonLink href={upgradeHref} variant="secondary">
            {WORLD_PROFILE.openUpgrade}
          </ButtonLink>
        </div>
      ) : null}

      {homeHref ? (
        <p className="small">
          <Link href={homeHref}>{SERIES.editIn(seriesBookLabel(seriesHome!))}</Link>
        </p>
      ) : null}
    </section>
  );
}
