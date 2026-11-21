"use client";

import { useActionState, useCallback, useState } from "react";
import { HeadingReviewDialog } from "@/components/world/HeadingReviewDialog";
import { WorldKindFields } from "@/components/world/WorldKindFields";
import { HelpHint } from "@/components/HelpHint";
import { IssueList } from "@/components/IssueList";
import { ReferenceMetaFields } from "@/components/world/ReferenceMetaFields";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { REFERENCE_FORM } from "@/ui/labels";
import { worldHref } from "@/ui/world";
import { isReferenceTemplateKey, REFERENCE_TEMPLATES, type ReferenceTemplateKey } from "@/world/referenceTemplates";
import type { SpellingLanguage } from "@/writing/spelling";
import { createRecordAction, type FormResult } from "@/app/projects/[projectId]/actions";

const ENTRY_TYPES = [
  ["character_dossier", REFERENCE_FORM.typeCharacter],
  ["worldbuilding", REFERENCE_FORM.typeWorldbuilding],
  ["rules_glossary", REFERENCE_FORM.typeRules],
  ["research_note", REFERENCE_FORM.typeResearch],
] as const;

export function ReferenceCreateForm({
  projectId,
  spellingLanguage,
  defaultType = "character_dossier",
}: {
  projectId: string;
  spellingLanguage: SpellingLanguage;
  defaultType?: (typeof ENTRY_TYPES)[number][0];
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    createRecordAction.bind(null, projectId),
    { ok: true },
  );
  const initialType = ENTRY_TYPES.some(([type]) => type === defaultType) ? defaultType : "character_dossier";
  const [recordType, setRecordType] = useState<(typeof ENTRY_TYPES)[number][0]>(initialType);
  const [fieldsJson, setFieldsJson] = useState("{}");
  const [fieldsValid, setFieldsValid] = useState(true);
  const [body, setBody] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const onValidity = useCallback((valid: boolean) => setFieldsValid(valid), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const selectedTemplate = isReferenceTemplateKey(templateKey) ? templateKey : null;

  return (
    <form
      className="reference-composer"
      onSubmit={(event) => {
        if (!fieldsValid) {
          event.preventDefault();
          return;
        }
        submitWithoutReset(action)(event);
      }}
    >
      <div className="reference-composer-grid">
        <label className="reference-title-field">
          {REFERENCE_FORM.title}
          <input type="text" name="title" required spellCheck lang={spellingLanguage} />
        </label>
        <RadioGroup
          className="reference-type-field"
          legend={REFERENCE_FORM.documentType}
          name="type"
          value={recordType}
          hint={REFERENCE_FORM.documentTypeHint}
          onValueChange={(value) => {
            const next = ENTRY_TYPES.find(([type]) => type === value);
            if (next) setRecordType(next[0]);
          }}
          options={ENTRY_TYPES.map(([value, label]) => ({ value, label }))}
        />
        <WorldKindFields
          fieldsJson={fieldsJson}
          onFieldsJsonChange={setFieldsJson}
          onValidityChange={onValidity}
          showKind={recordType === "worldbuilding"}
          extraDetails={
            recordType === "character_dossier" ? (
              <ReferenceMetaFields
                bare
                recordType={recordType}
                fieldsJson={fieldsJson}
                onFieldsJsonChange={setFieldsJson}
              />
            ) : null
          }
        />
        <div className="reference-headings">
          <label>
            {REFERENCE_FORM.headings}
            <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
              <option value="">{REFERENCE_FORM.headingsNone}</option>
              {REFERENCE_TEMPLATES.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="secondary" disabled={!selectedTemplate} onClick={() => setPreviewOpen(true)}>
            {REFERENCE_FORM.previewHeadings}
          </Button>
          <p className="small muted reference-headings-hint">{REFERENCE_FORM.headingsHint}</p>
        </div>
        <label className="reference-writing-field">
          {REFERENCE_FORM.writing}
          <textarea
            name="body"
            className="document"
            spellCheck
            lang={spellingLanguage}
            placeholder={REFERENCE_FORM.writingPlaceholder}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setUndoBody(null);
            }}
          />
        </label>
      </div>
      {notice ? (
        <p className="small" role="status">
          {notice}{" "}
          {undoBody !== null ? (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setBody(undoBody);
                setUndoBody(null);
                setNotice("");
              }}
            >
              {REFERENCE_FORM.undoHeadings}
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="reference-save-row">
        <label className="reference-canon">
          {REFERENCE_FORM.canonStatus}
          <select name="authorityStatus" defaultValue="draft">
            {AUTHORITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <p className="small muted reference-draft-hint">{REFERENCE_FORM.draftHint}</p>
        <div className="reference-save-actions">
          <ButtonLink href={worldHref(projectId)} variant="secondary">
            {REFERENCE_FORM.cancel}
          </ButtonLink>
          <Button type="submit" disabled={pending || !fieldsValid}>
            {REFERENCE_FORM.create}
          </Button>
        </div>
      </div>
      <input type="hidden" name="fields" value={fieldsJson} />
      <HelpHint anchor="canon-status" topic="canon status">
        Status is your call: only &ldquo;approved&rdquo; marks something as canon.
      </HelpHint>
      {state.message ? <Banner tone="error">{state.message}</Banner> : null}
      <IssueList issues={state.issues ?? []} />
      <HeadingReviewDialog
        open={previewOpen}
        templateKey={selectedTemplate as ReferenceTemplateKey | null}
        body={body}
        onClose={closePreview}
        onApply={(next) => {
          setUndoBody(body);
          setBody(next);
          setNotice(REFERENCE_FORM.addedUnsaved);
          setPreviewOpen(false);
        }}
      />
    </form>
  );
}
