"use client";

import { useMemo, useState } from "react";
import { parseJsonObject, type JsonObject } from "@/domain/json";
import { WORLD_KIND } from "@/ui/labels";
import {
  applyWorldKindToFields,
  formatWorldKindFieldValue,
  WORLD_KIND_CUSTOM_UI,
  WORLD_KIND_FIELD_SPECS,
  worldbuildingKindFromFields,
  worldKindEditorMode,
} from "@/world/worldKinds";
import { REFERENCE_TEMPLATES } from "@/world/referenceTemplates";

function parseFields(text: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return parseJsonObject(trimmed);
  } catch {
    return {};
  }
}

export function WorldKindFields({
  fieldsJson,
  onFieldsJsonChange,
  disabled,
}: {
  fieldsJson: string;
  onFieldsJsonChange: (next: string) => void;
  disabled?: boolean;
}) {
  const parsed = useMemo(() => parseFields(fieldsJson), [fieldsJson]);
  const knownKind = worldbuildingKindFromFields(parsed);
  // Custom… has to stay selected before a name exists. An empty kind is stored as "no kind".
  const [customPending, setCustomPending] = useState(false);
  if (customPending && knownKind) setCustomPending(false);
  const mode = worldKindEditorMode(parsed, customPending);
  const specs = knownKind ? WORLD_KIND_FIELD_SPECS[knownKind] : [];

  const sync = (nextKind: string, values: Record<string, string>) => {
    const next = applyWorldKindToFields(parsed, nextKind, values);
    onFieldsJsonChange(JSON.stringify(next, null, 2));
  };

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const spec of specs) out[spec.key] = formatWorldKindFieldValue(parsed[spec.key]);
    return out;
  }, [parsed, specs]);

  return (
    <fieldset className="stack world-kind-fields" disabled={disabled}>
      <legend className="sr-only">{WORLD_KIND.legend}</legend>
      <label>
        {WORLD_KIND.kindLabel}
        <select
          value={mode.selectValue}
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
          {REFERENCE_TEMPLATES.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
          <option value={WORLD_KIND_CUSTOM_UI}>{WORLD_KIND.kindCustomOption}</option>
        </select>
      </label>
      {mode.selectValue === WORLD_KIND_CUSTOM_UI ? (
        <label>
          {WORLD_KIND.customLabel}
          <input
            type="text"
            value={mode.customName}
            placeholder={WORLD_KIND.customPlaceholder}
            onChange={(event) => sync(event.target.value, values)}
          />
        </label>
      ) : null}
      <p className="small muted">{WORLD_KIND.note}</p>
      {specs.length ? (
        <div className="grid2">
          {specs.map((spec) => (
            <label key={spec.key}>
              {spec.label}
              <input
                type="text"
                value={values[spec.key] ?? ""}
                placeholder={spec.placeholder}
                onChange={(event) => sync(mode.selectValue === WORLD_KIND_CUSTOM_UI ? mode.customName : mode.selectValue, { ...values, [spec.key]: event.target.value })}
              />
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}