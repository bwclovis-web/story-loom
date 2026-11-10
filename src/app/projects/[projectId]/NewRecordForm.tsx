"use client";

import { useActionState } from "react";
import { HelpHint } from "@/components/HelpHint";
import { IssueList } from "@/components/IssueList";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { RECORD_TYPE_LABELS, RECORD_TYPES, requiresParent, type RecordType } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { RECORD } from "@/ui/labels";
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

  return (
    <form onSubmit={submitWithoutReset(action)} className="stack">
      <div className="row">
        <label>
          Type
          <select name="type" defaultValue={defaultType}>
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
        {RECORD.bodyLabel}
        <textarea name="body" className="document" spellCheck lang={spellingLanguage} />
      </label>
      <label>
        {RECORD.newFieldsLabel}
        <textarea
          name="fields"
          className="mono"
          style={{ minHeight: "4rem" }}
          placeholder='{"aliases": ["..."]}'
          spellCheck={false}
        />
      </label>
      {state.message ? <div className="banner error">{state.message}</div> : null}
      <IssueList issues={state.issues ?? []} />
      <div>
        <button type="submit" disabled={pending}>
          {RECORD.createRecord}
        </button>
      </div>
    </form>
  );
}
