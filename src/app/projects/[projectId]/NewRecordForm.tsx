"use client";

import { useActionState, useRef, useState } from "react";
import { WorldKindFields } from "@/components/world/WorldKindFields";
import { HelpHint } from "@/components/HelpHint";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { isRecordType, RECORD_TYPE_LABELS, RECORD_TYPES, requiresParent, type RecordType } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { RECORD, WORLD } from "@/ui/labels";
import { isReferenceTemplateKey, REFERENCE_TEMPLATES, referenceTemplate, scaffoldBody } from "@/world/referenceTemplates";
import type { SpellingLanguage } from "@/writing/spelling";
import { createRecordAction, type FormResult } from "./actions";

export function NewRecordForm({
  projectId,
  spellingLanguage,
  defaultType,
}: {
  projectId: string;
  spellingLanguage: SpellingLanguage;
  defaultType: RecordType;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    createRecordAction.bind(null, projectId),
    { ok: true },
  );
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastScaffold = useRef("");
  const [recordType, setRecordType] = useState<RecordType>(defaultType);
  const [fieldsJson, setFieldsJson] = useState("{}");

  return (
    <form onSubmit={submitWithoutReset(action)} className="stack">
      <div className="row">
        <label>
          Type
          <select
            name="type"
            defaultValue={defaultType}
            onChange={(event) => isRecordType(event.target.value) && setRecordType(event.target.value)}
          >
            {RECORD_TYPES.filter((t) => !requiresParent(t)).map((t) => (
              <option key={t} value={t}>
                {RECORD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="authorityStatus" defaultValue="draft">
            {AUTHORITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Title
          <input type="text" name="title" required spellCheck lang={spellingLanguage} />
        </label>
      </div>
      <HelpHint anchor="canon-status" topic="canon status">
        Status is your call: only &ldquo;approved&rdquo; marks something as canon. Manuscript chapters and scenes are
        protected automatically.
      </HelpHint>
      <label>
        {WORLD.outlineNew}
        <select
          name="outline"
          defaultValue=""
          onChange={(event) => {
            const key = event.target.value;
            const el = bodyRef.current;
            if (!el) return;
            const next = isReferenceTemplateKey(key) ? scaffoldBody(referenceTemplate(key)) : "";
            if (el.value.trim() === "" || el.value === lastScaffold.current) {
              el.value = next;
              lastScaffold.current = next;
            }
          }}
        >
          <option value="">{WORLD.outlineNone}</option>
          {REFERENCE_TEMPLATES.map((template) => (
            <option key={template.key} value={template.key}>
              {template.label}
            </option>
          ))}
        </select>
      </label>
      <p className="small muted">{WORLD.outlineNewHint}</p>
      <label>
        {RECORD.bodyLabel}
        <textarea ref={bodyRef} name="body" className="document" spellCheck lang={spellingLanguage} />
      </label>
      {recordType === "worldbuilding" ? <WorldKindFields fieldsJson={fieldsJson} onFieldsJsonChange={setFieldsJson} /> : null}
      <label>
        {RECORD.newFieldsLabel}
        <textarea
          name="fields"
          className="mono"
          style={{ minHeight: "4rem" }}
          placeholder='{"aliases": ["..."]}'
          spellCheck={false}
          value={fieldsJson}
          onChange={(event) => setFieldsJson(event.target.value)}
        />
      </label>
      {state.message ? <Banner tone="error">{state.message}</Banner> : null}
      <IssueList issues={state.issues ?? []} />
      <div>
        <button type="submit" disabled={pending}>
          {RECORD.createRecord}
        </button>
      </div>
    </form>
  );
}
