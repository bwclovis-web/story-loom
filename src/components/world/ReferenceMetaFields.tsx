"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { cn } from "@/ui/cn";
import type { JsonObject } from "@/domain/json";
import type { RecordType } from "@/domain/recordTypes";
import { REFERENCE_META } from "@/ui/labels";
import { fieldDraftText, parseFieldDraft } from "@/world/fieldDraft";
import { readReferenceMeta, withReferenceMeta } from "@/world/referenceMeta";

/**
 * Name, alias chips, and role or summary for dossiers, decisions, and continuity notes.
 * Unknown JSON keys stay on the same field draft.
 */
export function ReferenceMetaFields({
  recordType,
  fieldsJson,
  onFieldsJsonChange,
  disabled,
  className,
  bare,
}: {
  recordType: RecordType;
  fieldsJson: string;
  onFieldsJsonChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  /** Render the fields without a second legend, for use inside Details. */
  bare?: boolean;
}) {
  const draft = useMemo(() => parseFieldDraft(fieldsJson), [fieldsJson]);
  const meta = draft.ok ? readReferenceMeta(draft.value) : null;
  const [aliasDraft, setAliasDraft] = useState("");
  const showRole = recordType === "character_dossier";
  const showSummary = recordType === "canon_decision" || recordType === "continuity_note";

  const publish = (next: JsonObject) => {
    onFieldsJsonChange(fieldDraftText(next));
  };

  const addAlias = () => {
    if (!draft.ok || !meta) return;
    const alias = aliasDraft.trim();
    if (!alias || meta.aliases.includes(alias)) {
      setAliasDraft("");
      return;
    }
    publish(withReferenceMeta(draft.value, { aliases: [...meta.aliases, alias] }));
    setAliasDraft("");
  };

  return (
    <fieldset className={cn("stack reference-meta-fields", className)} disabled={disabled || !draft.ok}>
      {bare ? null : <legend>{REFERENCE_META.legend}</legend>}
      {bare ? null : <p className="small muted">{REFERENCE_META.hint}</p>}
      {!draft.ok ? <p className="small">{REFERENCE_META.hint}</p> : null}
      <label>
        {REFERENCE_META.name}
        <input
          type="text"
          value={meta?.name ?? ""}
          disabled={disabled || !draft.ok}
          onChange={(event) => {
            if (!draft.ok) return;
            publish(withReferenceMeta(draft.value, { name: event.target.value }));
          }}
        />
      </label>
      <div className="stack">
        <span>{REFERENCE_META.aliases}</span>
        {meta && meta.aliases.length ? (
          <ul className="row" style={{ flexWrap: "wrap", gap: "0.35rem", listStyle: "none", padding: 0, margin: 0 }}>
            {meta.aliases.map((alias) => (
              <li key={alias}>
                <span className="small" style={{ border: "1px solid var(--color-border)", borderRadius: "999px", padding: "0.15rem 0.45rem" }}>
                  {alias}{" "}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || !draft.ok}
                    onClick={() => {
                      if (!draft.ok || !meta) return;
                      publish(withReferenceMeta(draft.value, { aliases: meta.aliases.filter((item) => item !== alias) }));
                    }}
                  >
                    {REFERENCE_META.removeAlias}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          <label>
            <span className="sr-only">{REFERENCE_META.addAlias}</span>
            <input
              type="text"
              value={aliasDraft}
              placeholder={REFERENCE_META.aliasPlaceholder}
              disabled={disabled || !draft.ok}
              onChange={(event) => setAliasDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addAlias();
              }}
            />
          </label>
          <Button type="button" variant="secondary" disabled={disabled || !draft.ok} onClick={addAlias}>
            {REFERENCE_META.addAlias}
          </Button>
        </div>
      </div>
      {showRole ? (
        <label>
          {REFERENCE_META.role}
          <input
            type="text"
            value={meta?.role ?? ""}
            disabled={disabled || !draft.ok}
            onChange={(event) => {
              if (!draft.ok) return;
              publish(withReferenceMeta(draft.value, { role: event.target.value }));
            }}
          />
        </label>
      ) : null}
      {showSummary ? (
        <label>
          {REFERENCE_META.summary}
          <textarea
            rows={3}
            value={meta?.summary ?? ""}
            disabled={disabled || !draft.ok}
            onChange={(event) => {
              if (!draft.ok) return;
              publish(withReferenceMeta(draft.value, { summary: event.target.value }));
            }}
          />
        </label>
      ) : null}
    </fieldset>
  );
}
