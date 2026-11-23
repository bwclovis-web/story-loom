"use client";

import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { Banner } from "@/components/ui/Banner";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { TextField } from "@/components/ui/TextField";
import type {
  WorldProfile,
  WorldProfileFieldValue,
  WorldProfileQuantity,
  WorldQuantityQualifier,
} from "@/domain/worldProfile";
import {
  emptyWorldProfile,
  formatWorldProfileFieldValue,
  WORLD_QUANTITY_QUALIFIERS,
  worldFieldMetaOf,
} from "@/domain/worldProfile";
import { SERIES, WORLD_PROFILE } from "@/ui/labels";
import type {
  WorldProfileDefinition,
  WorldProfileFieldDef,
  WorldSubcategorySectionDef,
} from "@/world/worldProfileRegistry";
import {
  getSubcategorySection,
  listAllSubcategorySections,
  listSubcategorySectionsWithStoredValues,
} from "@/world/worldProfileRegistry";
import type { PlaceRelationView } from "@/world/placeRelations";
import { seriesBookLabel, type SeriesHomeRef } from "@/world/seriesHome";
import {
  WorldProfileHistorySection,
  type WorldHistoryCatalog,
} from "@/components/world/WorldProfileHistorySection";
import { saveWorldProfileAction } from "@/app/projects/[projectId]/records/[recordId]/world-upgrade/actions";

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

function asQuantity(value: WorldProfileFieldValue): WorldProfileQuantity | null {
  if (value && typeof value === "object" && !Array.isArray(value) && "amount" in value) {
    const amount = (value as WorldProfileQuantity).amount;
    if (typeof amount === "number" && Number.isFinite(amount)) return value as WorldProfileQuantity;
  }
  return null;
}

function fieldEditorValue(field: WorldProfileFieldDef, value: WorldProfileFieldValue): string {
  if (field.type === "calendar_date") {
    if (value && typeof value === "object" && !Array.isArray(value) && "freeText" in value) {
      return typeof value.freeText === "string" ? value.freeText : formatWorldProfileFieldValue(value);
    }
    return formatWorldProfileFieldValue(value);
  }
  if (field.type === "record_ref") {
    if (typeof value === "string") return value;
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
  if (field.type === "quantity") {
    const quantity = asQuantity(value);
    return quantity ? String(quantity.amount) : "";
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
    case "quantity":
      if (trimmed === "") return null;
      {
        const amount = Number(raw);
        if (!Number.isFinite(amount)) return null;
        return { amount };
      }
    default:
      return raw;
  }
}

function QuantityFieldEditor({
  field,
  value,
  disabled,
  onChange,
}: {
  field: WorldProfileFieldDef;
  value: WorldProfileFieldValue;
  disabled: boolean;
  onChange: (next: WorldProfileFieldValue) => void;
}) {
  const quantity = asQuantity(value);
  const amountText = quantity ? String(quantity.amount) : "";
  const qualifier = quantity?.qualifier ?? "exact";
  const unit = quantity?.unit ?? "";
  const allowUnit = field.quantityConfig?.allowUnit === true;
  const allowQualifiers = field.quantityConfig?.allowQualifiers !== false;
  const listId = `quantity-units-${field.key}`;

  const patch = (partial: Partial<WorldProfileQuantity> | null, clear = false) => {
    if (clear || (partial && "amount" in partial && partial.amount === undefined)) {
      onChange(null);
      return;
    }
    if (!quantity && partial?.amount === undefined && amountText === "") {
      onChange(null);
      return;
    }
    const nextAmount =
      partial && "amount" in partial
        ? partial.amount
        : quantity
          ? quantity.amount
          : undefined;
    if (nextAmount === undefined || (typeof nextAmount === "number" && !Number.isFinite(nextAmount))) {
      onChange(null);
      return;
    }
    const next: WorldProfileQuantity = { amount: nextAmount as number };
    const nextQualifier = partial?.qualifier !== undefined ? partial.qualifier : quantity?.qualifier;
    const nextUnit = partial?.unit !== undefined ? partial.unit : quantity?.unit;
    if (nextQualifier && nextQualifier !== "exact") next.qualifier = nextQualifier;
    if (nextUnit?.trim()) next.unit = nextUnit.trim().slice(0, 40);
    onChange(next);
  };

  return (
    <div className="stack" style={{ gap: "0.35rem" }}>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}>
        {allowQualifiers ? (
          <label className="small">
            {WORLD_PROFILE.quantityQualifier}
            <select
              value={qualifier}
              disabled={disabled}
              onChange={(event) =>
                patch({
                  qualifier: event.target.value as WorldQuantityQualifier,
                  amount: quantity?.amount,
                })
              }
            >
              {WORLD_QUANTITY_QUALIFIERS.map((id) => (
                <option key={id} value={id}>
                  {WORLD_PROFILE.quantityQualifiers[id]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="small">
          {WORLD_PROFILE.quantityAmount}
          <input
            type="number"
            step={field.quantityConfig?.integerOnly ? 1 : "any"}
            value={amountText}
            disabled={disabled}
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (raw === "") {
                onChange(null);
                return;
              }
              const amount = Number(event.target.value);
              if (!Number.isFinite(amount)) return;
              patch({ amount, qualifier: quantity?.qualifier, unit: quantity?.unit });
            }}
          />
        </label>
        {allowUnit ? (
          <label className="small">
            {WORLD_PROFILE.quantityUnit}
            <input
              type="text"
              list={listId}
              value={unit}
              disabled={disabled || !quantity}
              onChange={(event) => patch({ unit: event.target.value, amount: quantity?.amount })}
            />
            {field.quantityConfig?.unitSuggestions?.length ? (
              <datalist id={listId}>
                {field.quantityConfig.unitSuggestions.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            ) : null}
          </label>
        ) : null}
      </div>
      <span className="small muted">{WORLD_PROFILE.quantityUnknownHint}</span>
    </div>
  );
}

function ProfileFieldRow({
  field,
  value,
  editable,
  pending,
  onValueChange,
  extra,
}: {
  field: WorldProfileFieldDef;
  value: WorldProfileFieldValue;
  editable: boolean;
  pending: boolean;
  onValueChange: (next: WorldProfileFieldValue) => void;
  extra?: ReactNode;
}) {
  const editorValue = fieldEditorValue(field, value);
  const listLike =
    field.type === "long_text" ||
    field.multiline ||
    field.type === "ordered_list" ||
    field.type === "multi_select" ||
    field.type === "record_refs";

  return (
    <label>
      {field.label}
      {field.description ? <span className="small muted"> — {field.description}</span> : null}
      {field.type === "quantity" ? (
        <QuantityFieldEditor
          field={field}
          value={value}
          disabled={!editable || pending}
          onChange={onValueChange}
        />
      ) : listLike ? (
        <textarea
          rows={field.type === "long_text" || field.multiline ? 3 : 2}
          value={editorValue}
          disabled={!editable || pending}
          placeholder={
            field.placeholder ??
            (field.type === "ordered_list" || field.type === "record_refs" || field.type === "multi_select"
              ? "One item per line"
              : undefined)
          }
          onChange={(event) => onValueChange(parseFieldEditorValue(field, event.target.value))}
        />
      ) : field.type === "boolean" ? (
        <select
          value={editorValue}
          disabled={!editable || pending}
          onChange={(event) => onValueChange(parseFieldEditorValue(field, event.target.value))}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          value={editorValue}
          disabled={!editable || pending}
          placeholder={field.placeholder}
          onChange={(event) => onValueChange(parseFieldEditorValue(field, event.target.value))}
        />
      )}
      {extra}
    </label>
  );
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
  suggestedSectionIds = [],
  placeRelations = null,
  placeChoices = [],
  editable,
  seriesHome,
  isProtected,
  historyCatalog,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  body: string;
  profile: WorldProfile | null;
  definition: WorldProfileDefinition | null;
  definitions: readonly WorldProfileDefinition[];
  plausibleDefinitions?: readonly WorldProfileDefinition[];
  suggestedSectionIds?: readonly string[];
  placeRelations?: { outgoing: PlaceRelationView[]; incoming: PlaceRelationView[] } | null;
  placeChoices?: Array<{ id: string; title: string; typeLabel: string; homeLabel?: string | null }>;
  editable: boolean;
  seriesHome: SeriesHomeRef | null;
  isProtected: boolean;
  historyCatalog: WorldHistoryCatalog;
}) {
  const [profile, setProfile] = useState<WorldProfile>(initialProfile ?? emptyWorldProfile());
  const [unlockProtected, setUnlockProtected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [bodyOpen, setBodyOpen] = useState(false);
  const [addSectionId, setAddSectionId] = useState("");

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

  const enabledSet = useMemo(() => new Set(profile.enabledSections), [profile.enabledSections]);
  const suggestedSet = useMemo(() => new Set(suggestedSectionIds), [suggestedSectionIds]);
  const activeSections = useMemo(() => {
    const fromStored = listSubcategorySectionsWithStoredValues(profile);
    const fromEnabled = profile.enabledSections
      .map((id) => getSubcategorySection(id))
      .filter((section): section is WorldSubcategorySectionDef => Boolean(section));
    const byId = new Map<string, WorldSubcategorySectionDef>();
    for (const section of [...fromEnabled, ...fromStored]) byId.set(section.id, section);
    return [...byId.values()];
  }, [profile]);
  const suggestedToAdd = useMemo(
    () =>
      suggestedSectionIds
        .map((id) => getSubcategorySection(id))
        .filter((section): section is WorldSubcategorySectionDef => Boolean(section) && !enabledSet.has(section!.id)),
    [suggestedSectionIds, enabledSet],
  );
  const addableSections = useMemo(
    () => listAllSubcategorySections().filter((section) => !enabledSet.has(section.id)),
    [enabledSet],
  );

  const flowsIntoOutgoing = useMemo(
    () => (placeRelations?.outgoing ?? []).filter((rel) => rel.kind === "flows_into"),
    [placeRelations],
  );

  const upgradeHref = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}/world-upgrade`;
  const placeRelationsHref = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}#place-relations`;
  const homeHref = seriesHome
    ? `/projects/${encodeURIComponent(seriesHome.projectId)}/records/${encodeURIComponent(recordId)}`
    : null;

  const setFieldValue = (key: string, next: WorldProfileFieldValue) => {
    setProfile((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: next,
      },
    }));
  };

  const enableSection = (sectionId: string) => {
    setProfile((current) => {
      if (current.enabledSections.includes(sectionId)) return current;
      return { ...current, enabledSections: [...current.enabledSections, sectionId] };
    });
  };

  const hideSection = (sectionId: string) => {
    setProfile((current) => ({
      ...current,
      enabledSections: current.enabledSections.filter((id) => id !== sectionId),
    }));
  };

  const useFlowsIntoOutlet = (rel: PlaceRelationView) => {
    setFieldValue("outlet", { recordId: rel.toRecordId });
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await saveWorldProfileAction(projectId, recordId, {
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

  const renderFieldMeta = (fieldKey: string) => {
    const meta = worldFieldMetaOf(profile, `values.${fieldKey}`);
    return (
      <span className="small muted">
        {WORLD_PROFILE.approval}: {meta.approval} · {WORLD_PROFILE.provenance}: {meta.provenance.origin}
      </span>
    );
  };

  const renderSectionField = (field: WorldProfileFieldDef) => {
    const raw = profile.values[field.key] ?? null;
    const isOutlet = field.key === "outlet";
    const outletText =
      isOutlet && raw && typeof raw === "object" && !Array.isArray(raw) && "recordId" in raw
        ? String((raw as { recordId: string }).recordId)
        : raw;
    return (
      <div key={field.key} className="stack" style={{ gap: "0.25rem" }}>
        <ProfileFieldRow
          field={{
            ...field,
            placeholder: isOutlet ? WORLD_PROFILE.outletTextFallback : field.placeholder,
          }}
          value={isOutlet ? ((typeof outletText === "string" ? outletText : null) as WorldProfileFieldValue) : raw}
          editable={editable}
          pending={pending}
          onValueChange={(next) => {
            if (isOutlet) {
              const trimmed =
                typeof next === "string" ? next.trim() : formatWorldProfileFieldValue(next).trim();
              setFieldValue(field.key, trimmed ? trimmed.slice(0, 200) : null);
              return;
            }
            setFieldValue(field.key, next);
          }}
          extra={renderFieldMeta(field.key)}
        />
        {isOutlet ? (
          <div className="stack" style={{ gap: "0.25rem" }}>
            {flowsIntoOutgoing.length ? (
              flowsIntoOutgoing.map((rel) => (
                <div key={rel.id} className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <span className="small muted">{WORLD_PROFILE.outletFromFlowsInto(rel.toTitle)}</span>
                  {editable ? (
                    <Button type="button" variant="secondary" disabled={pending} onClick={() => useFlowsIntoOutlet(rel)}>
                      {WORLD_PROFILE.useFlowsInto}
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="small muted">
                No <code>flows_into</code> place relationship yet.{" "}
                <Link href={placeRelationsHref}>{WORLD_PROFILE.editPlaceRelations}</Link>
                {placeChoices.length && editable ? " or pick a known place below." : "."}
              </p>
            )}
            {editable && placeChoices.length ? (
              <label className="small">
                Add outlet via place record
                <select
                  defaultValue=""
                  disabled={pending}
                  onChange={(event) => {
                    const id = event.target.value;
                    if (!id) return;
                    setFieldValue("outlet", { recordId: id });
                    event.target.value = "";
                  }}
                >
                  <option value="">—</option>
                  {placeChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.title}
                      {choice.homeLabel ? ` (${choice.homeLabel})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="small">
              <Link href={placeRelationsHref}>{WORLD_PROFILE.editPlaceRelations}</Link>
            </p>
          </div>
        ) : null}
      </div>
    );
  };

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
        <HelpPopover label={WORLD_PROFILE.definitionExplain}>{WORLD_PROFILE.definitionHelp}</HelpPopover>
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
          {profileFields.map((field) => (
            <div key={field.key} className="stack" style={{ gap: "0.25rem" }}>
              <ProfileFieldRow
                field={field}
                value={profile.values[field.key] ?? null}
                editable={editable}
                pending={pending}
                onValueChange={(next) => setFieldValue(field.key, next)}
                extra={renderFieldMeta(field.key)}
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted">{WORLD_PROFILE.empty}</p>
      )}

      <div className="stack" id="world-profile-subcategory-sections">
        <h3 className="small">{WORLD_PROFILE.subcategorySections}</h3>
        <p className="small muted">{WORLD_PROFILE.subcategorySectionsLead}</p>

        {suggestedToAdd.length ? (
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <span className="small muted">{WORLD_PROFILE.subcategorySuggested}:</span>
            {suggestedToAdd.map((section) => (
              <Button
                key={section.id}
                type="button"
                variant="secondary"
                disabled={!editable || pending}
                onClick={() => enableSection(section.id)}
              >
                {WORLD_PROFILE.subcategoryEnable(section.label)}
              </Button>
            ))}
          </div>
        ) : null}

        {editable && addableSections.length ? (
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}>
            <label className="small">
              {WORLD_PROFILE.subcategoryAdd}
              <select
                value={addSectionId}
                disabled={pending}
                onChange={(event) => setAddSectionId(event.target.value)}
              >
                <option value="">—</option>
                {addableSections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !addSectionId}
              onClick={() => {
                if (!addSectionId) return;
                enableSection(addSectionId);
                setAddSectionId("");
              }}
            >
              Enable
            </Button>
          </div>
        ) : null}

        {activeSections.length ? (
          <div className="stack">
            <h4 className="small">{WORLD_PROFILE.subcategoryActive}</h4>
            {activeSections.map((section) => {
              const enabled = enabledSet.has(section.id);
              const taxonomyMatch = suggestedSet.has(section.id);
              return (
                <div key={section.id} className="panel stack" style={{ gap: "0.5rem" }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                    <div>
                      <strong>{section.label}</strong>
                      {!taxonomyMatch ? (
                        <span className="small muted"> · {WORLD_PROFILE.subcategorySavedBadge}</span>
                      ) : null}
                      <p className="small muted" style={{ margin: 0 }}>
                        {section.description}
                      </p>
                    </div>
                    {editable ? (
                      enabled ? (
                        <Button type="button" variant="secondary" disabled={pending} onClick={() => hideSection(section.id)}>
                          {WORLD_PROFILE.subcategoryHide}
                        </Button>
                      ) : (
                        <Button type="button" variant="secondary" disabled={pending} onClick={() => enableSection(section.id)}>
                          {WORLD_PROFILE.subcategoryEnable(section.label)}
                        </Button>
                      )
                    ) : null}
                  </div>
                  {enabled || listSubcategorySectionsWithStoredValues(profile).some((s) => s.id === section.id) ? (
                    <div className="stack">{section.fields.map((field) => renderSectionField(field))}</div>
                  ) : null}
                  {editable && enabled ? (
                    <p className="small muted">{WORLD_PROFILE.subcategoryHideNote}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

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
        enabledSectionIds={profile.enabledSections}
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
