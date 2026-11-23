"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { HeadingReviewDialog } from "@/components/world/HeadingReviewDialog";
import { TaxonomyFields } from "@/components/world/TaxonomyFields";
import { WorldKindFields } from "@/components/world/WorldKindFields";
import { HelpHint } from "@/components/HelpHint";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { IssueList } from "@/components/IssueList";
import { ReferenceMetaFields } from "@/components/world/ReferenceMetaFields";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Atoms/Button";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { AUTHORITY_STATUSES } from "@/domain/statuses";
import { WORLD_SCOPES, type WorldScope } from "@/domain/assignments";
import { Select } from "@/components/ui/Atoms/Select";
import {
  emptyWorldProfile,
  isWorldProfileRecordType,
  readWorldProfile,
  withoutWorldProfile,
  withWorldProfile,
  WORLD_PROFILE_KEY,
} from "@/domain/worldProfile";
import { REFERENCE_FORM, WORLD_PROFILE } from "@/ui/labels";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { worldHref, type WorldType } from "@/ui/world";
import { suggestedKindForCategory } from "@/world/hubDiscovery";
import { fieldDraftText, parseFieldDraft } from "@/world/fieldDraft";
import {
  isReferenceTemplateKey,
  referenceTemplate,
  REFERENCE_TEMPLATES,
  type ReferenceTemplateKey,
} from "@/world/referenceTemplates";
import {
  normalizeCustomTaxonomySlug,
  readRecordTaxonomy,
  withRecordTaxonomy,
  type RecordTaxonomyV1,
} from "@/world/taxonomy";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import type { SpellingLanguage } from "@/writing/spelling";
import { createRecordAction, type FormResult } from "@/app/projects/[projectId]/actions";

const ENTRY_TYPES: ReadonlyArray<readonly [WorldType, string]> = [
  ["character_dossier", REFERENCE_FORM.typeCharacter],
  ["worldbuilding", REFERENCE_FORM.typeWorldbuilding],
  ["rules_glossary", REFERENCE_FORM.typeRules],
  ["research_note", REFERENCE_FORM.typeResearch],
  ["canon_decision", REFERENCE_FORM.typeDecision],
  ["continuity_note", REFERENCE_FORM.typeContinuity],
  ["reference_note", REFERENCE_FORM.typeReferenceNote],
];

const SCOPE_CHOICES: ReadonlyArray<{ value: "" | WorldScope; label: string }> = [
  { value: "", label: REFERENCE_FORM.worldScopeUnassigned },
  ...WORLD_SCOPES.map((scope) => ({
    value: scope,
    label: scope === "book" ? REFERENCE_FORM.worldScopeBook : REFERENCE_FORM.worldScopeSeries,
  })),
];

/** Seed `fields.taxonomy` from Hub query defaults. Nothing is saved until the author creates the reference. */
function seedFieldsJson(category: string | null, subcategory: string | null, tag: string | null): string {
  const primaryCategory = normalizeCustomTaxonomySlug(category);
  const primarySub = primaryCategory ? normalizeCustomTaxonomySlug(subcategory) : null;
  const seedTag = normalizeCustomTaxonomySlug(tag, 80);
  if (!primaryCategory && !seedTag) return "{}";
  const taxonomy: RecordTaxonomyV1 = { version: 1 };
  if (primaryCategory) {
    taxonomy.primary = primarySub ? { category: primaryCategory, subcategory: primarySub } : { category: primaryCategory };
  }
  if (seedTag) taxonomy.tags = [seedTag];
  return fieldDraftText(withRecordTaxonomy({}, taxonomy));
}

export function ReferenceCreateForm({
  projectId,
  spellingLanguage,
  defaultType = "character_dossier",
  defaultCategory = null,
  defaultSubcategory = null,
  defaultTag = null,
  customCategories = [],
  profileDefinitions = [],
}: {
  projectId: string;
  spellingLanguage: SpellingLanguage;
  defaultType?: WorldType;
  defaultCategory?: string | null;
  defaultSubcategory?: string | null;
  defaultTag?: string | null;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
  profileDefinitions?: readonly { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    createRecordAction.bind(null, projectId),
    { ok: true },
  );
  const initialType = ENTRY_TYPES.some(([type]) => type === defaultType) ? defaultType : "character_dossier";
  const [recordType, setRecordType] = useState<WorldType>(initialType);
  const [fieldsJson, setFieldsJson] = useState(() => seedFieldsJson(defaultCategory, defaultSubcategory, defaultTag));
  const [fieldsValid, setFieldsValid] = useState(true);
  const [worldScope, setWorldScope] = useState<"" | WorldScope>("");
  const [body, setBody] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const onValidity = useCallback((valid: boolean) => setFieldsValid(valid), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const selectedTemplate = isReferenceTemplateKey(templateKey) ? templateKey : null;
  const showProfileDefinition = isWorldProfileRecordType(recordType) && profileDefinitions.length > 0;
  const profileDefinitionId = useMemo(() => {
    const draft = parseFieldDraft(fieldsJson);
    if (!draft.ok || !(WORLD_PROFILE_KEY in draft.value)) return "";
    return readWorldProfile(draft.value).profile.definitionId ?? "";
  }, [fieldsJson]);

  /** Writes fields.worldProfile only when a definition is chosen; clearing it omits the key. */
  const chooseProfileDefinition = (definitionId: string) => {
    const draft = parseFieldDraft(fieldsJson);
    if (!draft.ok) return;
    if (!definitionId) {
      setFieldsJson(fieldDraftText(withoutWorldProfile(draft.value)));
      return;
    }
    const current = WORLD_PROFILE_KEY in draft.value ? readWorldProfile(draft.value).profile : emptyWorldProfile();
    setFieldsJson(fieldDraftText(withWorldProfile(draft.value, { ...current, definitionId })));
  };

  // Optional suggestions from the chosen category. They only fill the form when the author clicks.
  const suggestion = useMemo(() => {
    const draft = parseFieldDraft(fieldsJson);
    if (!draft.ok) return null;
    const read = readRecordTaxonomy(draft.value);
    const category = read.ok ? (read.taxonomy?.primary?.category ?? null) : null;
    if (!category) return null;
    const kind = suggestedKindForCategory(category);
    const outline: ReferenceTemplateKey | null = kind ?? (category === "characters" ? "character" : null);
    const currentKind = worldbuildingKindFromFields(draft.value);
    const kindChoice = kind && recordType === "worldbuilding" && currentKind !== kind ? kind : null;
    const outlineChoice = outline && templateKey !== outline ? outline : null;
    if (!kindChoice && !outlineChoice) return null;
    return { kind: kindChoice, outline: outlineChoice, fields: draft.value };
  }, [fieldsJson, recordType, templateKey]);

  return (
    <form
      className="reference-composer pt-4"
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
          legend={
            <>
              {REFERENCE_FORM.documentType}
              <HelpPopover label={REFERENCE_FORM.documentTypeExplain}>{REFERENCE_FORM.documentTypeHelp}</HelpPopover>
            </>
          }
          name="type"
          value={recordType}
          hint={REFERENCE_FORM.documentTypeHint}
          onValueChange={(value) => {
            const next = ENTRY_TYPES.find(([type]) => type === value);
            if (!next) return;
            setRecordType(next[0]);
            if (!isWorldProfileRecordType(next[0])) {
              const draft = parseFieldDraft(fieldsJson);
              if (draft.ok && WORLD_PROFILE_KEY in draft.value) {
                setFieldsJson(fieldDraftText(withoutWorldProfile(draft.value)));
              }
            }
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
        <RadioGroup
          className="reference-type-field"
          legend={
            <>
              {REFERENCE_FORM.worldScopeLegend}
              <HelpPopover label={REFERENCE_FORM.worldScopeExplain}>{REFERENCE_FORM.worldScopeHelp}</HelpPopover>
            </>
          }
          name="worldScopeChoice"
          value={worldScope}
          hint={REFERENCE_FORM.worldScopeHint}
          onValueChange={(value) => setWorldScope(value === "book" || value === "series" ? value : "")}
          options={SCOPE_CHOICES.map(({ value, label }) => ({ value, label }))}
        />
        <TaxonomyFields
          className="reference-taxonomy-slot"
          fieldsJson={fieldsJson}
          onFieldsJsonChange={setFieldsJson}
          customCategories={customCategories}
        />
        {showProfileDefinition ? (
          <Select
            className="reference-taxonomy-slot"
            label={
              <>
                {WORLD_PROFILE.definition}
                <HelpPopover label={WORLD_PROFILE.definitionExplain}>{WORLD_PROFILE.definitionHelp}</HelpPopover>
              </>
            }
            hint={WORLD_PROFILE.optionalNote}
            value={profileDefinitionId}
            onChange={(event) => chooseProfileDefinition(event.target.value)}
          >
            <option value="">{WORLD_PROFILE.definitionNone}</option>
            {profileDefinitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.label}
              </option>
            ))}
          </Select>
        ) : null}
        {suggestion ? (
          <div className="reference-taxonomy-slot stack" role="group" aria-label={REFERENCE_FORM.suggestionLead}>
            <p className="small">
              <strong>{REFERENCE_FORM.suggestionLead}</strong>
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              {suggestion.kind ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setFieldsJson(fieldDraftText({ ...suggestion.fields, kind: suggestion.kind! }))}
                >
                  {REFERENCE_FORM.suggestionKind(referenceTemplate(suggestion.kind).label)}
                </Button>
              ) : null}
              {suggestion.outline ? (
                <Button type="button" variant="secondary" onClick={() => setTemplateKey(suggestion.outline!)}>
                  {REFERENCE_FORM.suggestionOutline(referenceTemplate(suggestion.outline).label)}
                </Button>
              ) : null}
            </div>
            <p className="small muted">{REFERENCE_FORM.suggestionNote}</p>
          </div>
        ) : null}
        <div className="reference-headings">
          <label>
            {REFERENCE_FORM.headings}
            <HelpPopover label={REFERENCE_FORM.headingsExplain}>{REFERENCE_FORM.headingsHelp}</HelpPopover>
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
          <HelpPopover label={REFERENCE_FORM.canonExplain}>{REFERENCE_FORM.canonHelp}</HelpPopover>
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
      <input type="hidden" name="worldScope" value={worldScope} />
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
