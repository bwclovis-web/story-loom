"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { HelpPopover } from "@/components/ui/HelpPopover";
import type { JsonObject, JsonValue } from "@/domain/json";
import {
  forgetWorldKindTemplateAction,
  saveWorldKindTemplateAction,
} from "@/app/projects/[projectId]/world/kindTemplateActions";
import { KIND_TEMPLATE, REFERENCE_FORM, WORLD_KIND } from "@/ui/labels";
import { parseKindTemplateFields, type KindTemplateField, type KindTemplateView } from "@/world/kindTemplates";
import { fieldDraftText, otherSavedEntries, parseFieldDraft, valueShape } from "@/world/fieldDraft";
import { isWorldKindKey, WORLD_KIND_KEYS, referenceTemplate } from "@/world/referenceTemplates";
import {
  applyWorldKindToFields,
  formatWorldKindFieldValue,
  WORLD_KIND_CUSTOM_UI,
  WORLD_KIND_FIELD_SPECS,
  worldbuildingKindFromFields,
  worldKindEditorMode,
} from "@/world/worldKinds";

function restoreKeptValues(before: JsonObject, after: JsonObject): JsonObject {
  const next = { ...after };
  for (const [key, value] of Object.entries(before)) {
    if (key === "kind") continue;
    if (typeof value !== "string" && before[key] !== undefined) next[key] = value as JsonValue;
  }
  return next;
}

/**
 * Kind classification and kind-specific details share one field draft.
 * Invalid JSON is kept as typed and blocks friendly overwrites.
 */
export function WorldKindFields({
  fieldsJson,
  onFieldsJsonChange,
  onValidityChange,
  disabled,
  showKind,
  projectId,
  kindTemplates = [],
  extraDetails,
}: {
  fieldsJson: string;
  onFieldsJsonChange: (next: string) => void;
  onValidityChange?: (valid: boolean) => void;
  disabled?: boolean;
  /** When false, kind controls stay hidden but saved fields are not cleared. */
  showKind?: boolean;
  projectId?: string;
  kindTemplates?: readonly KindTemplateView[];
  /** Reference details that belong in the Details panel, such as a character's name. */
  extraDetails?: ReactNode;
}) {
  const errorId = useId();
  const jsonId = useId();
  const [text, setText] = useState(fieldsJson);
  const [editingJson, setEditingJson] = useState(false);
  const [customPending, setCustomPending] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const draft = useMemo(() => parseFieldDraft(editingJson ? text : fieldsJson), [editingJson, text, fieldsJson]);
  const parsed = draft.ok ? draft.value : null;
  const knownKind = parsed ? worldbuildingKindFromFields(parsed) : null;

  useEffect(() => {
    onValidityChange?.(draft.ok);
  }, [draft.ok, onValidityChange]);

  useEffect(() => {
    if (!editingJson) setText(fieldsJson);
  }, [fieldsJson, editingJson]);

  if (customPending && knownKind) setCustomPending(false);
  const mode = worldKindEditorMode(parsed ?? {}, customPending);
  const specs = knownKind ? WORLD_KIND_FIELD_SPECS[knownKind] : [];
  const customName = mode.selectValue === WORLD_KIND_CUSTOM_UI ? mode.customName.trim() : "";
  const savedTemplate = customName ? kindTemplates.find((template) => template.kind === customName) : undefined;
  const [templateKind, setTemplateKind] = useState(customName);
  const [templateDraft, setTemplateDraft] = useState<KindTemplateField[]>(savedTemplate?.fields ?? []);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [templatePending, setTemplatePending] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newMultiline, setNewMultiline] = useState(false);
  if (templateKind !== customName) {
    setTemplateKind(customName);
    setTemplateDraft(savedTemplate?.fields ?? []);
    setTemplateMessage(null);
  }
  const fieldSpecs = customName ? templateDraft : specs;
  const fieldKeys = new Set(fieldSpecs.map((spec) => spec.key));
  const others = parsed ? otherSavedEntries(parsed).filter((entry) => !fieldKeys.has(entry.key)) : [];

  const publish = (next: JsonObject) => {
    const textNext = fieldDraftText(next);
    setEditingJson(false);
    setText(textNext);
    onFieldsJsonChange(textNext);
  };

  const sync = (nextKind: string, values: Record<string, string>, specsForValues: readonly { key: string }[] = fieldSpecs) => {
    if (!parsed) return;
    const applied = applyWorldKindToFields(parsed, nextKind, values);
    const next = restoreKeptValues(parsed, applied);
    if (nextKind !== "" && nextKind !== WORLD_KIND_CUSTOM_UI && !isWorldKindKey(nextKind)) {
      for (const spec of specsForValues) {
        const value = (values[spec.key] ?? "").trim();
        if (value) next[spec.key] = value;
        else delete next[spec.key];
      }
    }
    publish(next);
  };

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    if (!parsed) return out;
    for (const spec of fieldSpecs) {
      const current = parsed[spec.key];
      if (typeof current === "string" || current === undefined) out[spec.key] = formatWorldKindFieldValue(current);
    }
    return out;
  }, [parsed, fieldSpecs]);

  const kindValue = mode.selectValue === WORLD_KIND_CUSTOM_UI ? mode.customName : mode.selectValue;

  return (
    <>
      {showKind === false ? (
        parsed && Object.keys(parsed).length ? (
          <p className="small muted reference-kind-slot">{REFERENCE_FORM.kindRetained}</p>
        ) : (
          <span className="reference-kind-slot" />
        )
      ) : (
        <div className="reference-kind-slot stack">
          <div className="reference-kind-row">
          <label>
            {REFERENCE_FORM.kindLabel}
            <HelpPopover label={REFERENCE_FORM.kindExplain}>{REFERENCE_FORM.kindHelp}</HelpPopover>
            <select
              value={mode.selectValue}
              disabled={disabled || !parsed}
              onChange={(event) => {
                const value = event.target.value;
                if (value === WORLD_KIND_CUSTOM_UI) {
                  setCustomPending(true);
                  if (knownKind) sync("", values);
                  return;
                }
                setCustomPending(false);
                sync(value, values);
              }}
            >
              <option value="">{WORLD_KIND.kindNone}</option>
              {WORLD_KIND_KEYS.map((key) => (
                <option key={key} value={key}>
                  {referenceTemplate(key).label}
                </option>
              ))}
              <option value={WORLD_KIND_CUSTOM_UI}>{WORLD_KIND.kindCustomOption}</option>
            </select>
          </label>
          <p className="small muted">{REFERENCE_FORM.kindHint}</p>
          </div>
          {mode.selectValue === WORLD_KIND_CUSTOM_UI ? (
            <label>
              {WORLD_KIND.customLabel}
              <HelpPopover label={WORLD_KIND.customExplain}>{WORLD_KIND.customHelp}</HelpPopover>
              <input
                type="text"
                value={mode.customName}
                disabled={disabled || !parsed}
                placeholder={WORLD_KIND.customPlaceholder}
                onChange={(event) => sync(event.target.value, values)}
              />
            </label>
          ) : null}
          {mode.selectValue === WORLD_KIND_CUSTOM_UI && projectId ? (
            <div className="stack">
              <p className="small">
                <strong>{KIND_TEMPLATE.legend}</strong>
              </p>
              <p className="small muted">{KIND_TEMPLATE.hint}</p>
              {templateDraft.map((field) => (
                <div key={field.key} className="row">
                  <span className="small">
                    {field.label} <code>{field.key}</code>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || templatePending}
                    onClick={() => setTemplateDraft((current) => current.filter((item) => item.key !== field.key))}
                  >
                    {KIND_TEMPLATE.removeField}
                  </Button>
                </div>
              ))}
              <div className="row">
                <label>
                  {KIND_TEMPLATE.key}
                  <input value={newKey} disabled={disabled || templatePending} onChange={(event) => setNewKey(event.target.value)} />
                </label>
                <label>
                  {KIND_TEMPLATE.label}
                  <input value={newLabel} disabled={disabled || templatePending} onChange={(event) => setNewLabel(event.target.value)} />
                </label>
                <Checkbox
                  checked={newMultiline}
                  disabled={disabled || templatePending}
                  onChange={(event) => setNewMultiline(event.target.checked)}
                  label={KIND_TEMPLATE.multiline}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={disabled || templatePending || !customName}
                  onClick={() => {
                    const next = parseKindTemplateFields([...templateDraft, { key: newKey, label: newLabel, multiline: newMultiline }]);
                    if (next.length === templateDraft.length) return;
                    setTemplateDraft(next);
                    setNewKey("");
                    setNewLabel("");
                    setNewMultiline(false);
                  }}
                >
                  {KIND_TEMPLATE.addField}
                </Button>
              </div>
              <div className="row">
                <Button
                  type="button"
                  disabled={disabled || templatePending || !customName || templateDraft.length === 0}
                  onClick={() => {
                    if (!projectId || !customName) return;
                    setTemplatePending(true);
                    void saveWorldKindTemplateAction(projectId, customName, templateDraft).then((result) => {
                      setTemplatePending(false);
                      setTemplateMessage(result.ok ? KIND_TEMPLATE.remembered : result.error);
                    });
                  }}
                >
                  {KIND_TEMPLATE.remember}
                </Button>
                {savedTemplate ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={disabled || templatePending}
                    onClick={() => {
                      if (!projectId || !customName) return;
                      setTemplatePending(true);
                      void forgetWorldKindTemplateAction(projectId, customName).then((result) => {
                        setTemplatePending(false);
                        if (result.ok) {
                          setTemplateDraft([]);
                          setTemplateMessage(KIND_TEMPLATE.forgotten);
                        } else setTemplateMessage(result.error);
                      });
                    }}
                  >
                    {KIND_TEMPLATE.forget}
                  </Button>
                ) : null}
              </div>
              {!customName ? <p className="small muted">{KIND_TEMPLATE.needName}</p> : null}
              {templateMessage ? <p className="small">{templateMessage}</p> : null}
            </div>
          ) : null}
        </div>
      )}

      <details className="reference-details-slot" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>{REFERENCE_FORM.details}</summary>
        <div className="stack">
          <p className="small muted">{REFERENCE_FORM.detailsHint}</p>
          <p className="small muted">{REFERENCE_FORM.detailsEditHint}</p>
          {extraDetails}
          {fieldSpecs.length ? (
            fieldSpecs.map((spec) => {
              const stored = parsed?.[spec.key];
              if (stored !== undefined && typeof stored !== "string") return null;
              return (
                <label key={spec.key}>
                  {spec.label}
                  {spec.multiline ? (
                    <textarea
                      rows={4}
                      value={values[spec.key] ?? ""}
                      placeholder={"placeholder" in spec ? spec.placeholder : undefined}
                      disabled={disabled || !parsed}
                      onChange={(event) => sync(kindValue, { ...values, [spec.key]: event.target.value })}
                    />
                  ) : (
                    <input
                      type="text"
                      value={values[spec.key] ?? ""}
                      placeholder={"placeholder" in spec ? spec.placeholder : undefined}
                      disabled={disabled || !parsed}
                      onChange={(event) => sync(kindValue, { ...values, [spec.key]: event.target.value })}
                    />
                  )}
                </label>
              );
            })
          ) : showKind !== false && mode.selectValue === "" && !extraDetails ? (
            <p className="small muted">{REFERENCE_FORM.kindFieldsEmpty}</p>
          ) : null}
          {others.length ? (
            <div className="stack">
              <h3 className="small">{REFERENCE_FORM.otherSaved}</h3>
              <p className="small muted">{REFERENCE_FORM.otherSavedHint}</p>
              {others.map((entry) =>
                entry.editable ? (
                  <label key={entry.key}>
                    {entry.key}
                    <input
                      type="text"
                      value={typeof entry.value === "string" ? entry.value : ""}
                      disabled={disabled || !parsed}
                      onChange={(event) => {
                        if (!parsed) return;
                        const next: JsonObject = { ...parsed };
                        const typed = event.target.value;
                        if (typed.trim()) next[entry.key] = typed;
                        else delete next[entry.key];
                        publish(next);
                      }}
                    />
                  </label>
                ) : (
                  <p key={entry.key} className="small">
                    <code>{entry.key}</code> ({valueShape(entry.value)}). {REFERENCE_FORM.otherKept}
                  </p>
                ),
              )}
            </div>
          ) : null}
          <details className="reference-advanced-json">
            <summary>{REFERENCE_FORM.advancedJson}</summary>
            <label>
              <span className="sr-only">{REFERENCE_FORM.advancedJson}</span>
              <textarea
                id={jsonId}
                className="mono"
                rows={8}
                spellCheck={false}
                disabled={disabled}
                aria-invalid={!draft.ok}
                aria-describedby={draft.ok ? undefined : errorId}
                value={editingJson ? text : fieldsJson}
                onChange={(event) => {
                  const next = event.target.value;
                  setText(next);
                  setEditingJson(true);
                  const checked = parseFieldDraft(next);
                  if (checked.ok) {
                    setEditingJson(false);
                    onFieldsJsonChange(fieldDraftText(checked.value));
                  }
                }}
              />
            </label>
          </details>
        </div>
      </details>
      {!draft.ok ? (
        <p id={errorId} className="reference-json-error" role="alert">
          {REFERENCE_FORM.jsonInvalid} {draft.error}{" "}
          <button type="button" className="linkish" onClick={() => setDetailsOpen(true)}>
            {REFERENCE_FORM.showJsonError}
          </button>
        </p>
      ) : null}
    </>
  );
}
