"use client";

import { useActionState, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { HelpHint } from "@/components/HelpHint";
import { IssueList } from "@/components/IssueList";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import { FindReplace, type DirectUndo } from "@/components/writing/FindReplace";
import { Proofreader, type ProofreadConfig } from "@/components/writing/Proofreader";
import { SelectionAssister } from "@/components/writing/SelectionAssister";
import { setUnsaved } from "@/components/shell/unsaved";
import { SpellingLanguageSelect } from "@/components/writing/SpellingLanguageSelect";
import { SpellOverlay } from "@/components/writing/SpellOverlay";
import { flagAt, SpellingPanel } from "@/components/writing/SpellingPanel";
import { useSpellcheck } from "@/components/writing/useSpellcheck";
import { WordCounts } from "@/components/writing/WordCounts";
import { AUTHORITY_STATUSES, type AuthorityStatus } from "@/domain/statuses";
import { normalizeNewlines } from "@/proofread/anchors";
import type { DictionaryWord } from "@/spelling/dictionary";
import { applyTextareaEdit } from "@/components/writing/textareaEdit";
import { imageMarkdown } from "@/images/imageFormat";
import { HeadingReviewDialog } from "@/components/world/HeadingReviewDialog";
import { ReferenceMetaFields } from "@/components/world/ReferenceMetaFields";
import { WorldKindFields } from "@/components/world/WorldKindFields";
import type { KindTemplateView } from "@/world/kindTemplates";
import type { RecordType } from "@/domain/recordTypes";
import { IMAGES, RECORD, REFERENCE_FORM, WRITE, WRITING } from "@/ui/labels";
import { isWorldType } from "@/ui/world";
import { isReferenceTemplateKey, REFERENCE_TEMPLATES, type ReferenceTemplateKey } from "@/world/referenceTemplates";
import { CodexSuggestBox } from "@/components/writing/CodexSuggestBox";
import type { CodexEntry } from "@/writing/codexSuggest";
import { RecoveryBanner } from "@/writing/RecoveryBanner";
import { useLocalRecovery } from "@/writing/useLocalRecovery";
import { invertEdit } from "@/writing/findReplace";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { saveRecordAction, setStatusAction, type FormResult } from "../../actions";

function Result({ state }: { state: FormResult }) {
  return (
    <>
      {state.message ? <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner> : null}
      <IssueList issues={state.issues ?? []} />
    </>
  );
}

/** Saved fields come back re-formatted with sorted keys, so compare the JSON values rather than the text. */
function sameJson(a: string, b: string): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
        : value;
  try {
    return JSON.stringify(canonical(JSON.parse(a.trim() || "{}"))) === JSON.stringify(canonical(JSON.parse(b.trim() || "{}")));
  } catch {
    return a === b;
  }
}

function InsertImage({
  images,
  disabled,
  onInsert,
}: {
  images: { name: string; label: string }[];
  disabled: boolean;
  onInsert: (markdown: string) => void;
}) {
  const [choice, setChoice] = useState(images[0].name);
  const selected = images.find((i) => i.name === choice) ?? images[0];
  return (
    <div className="row insert-image">
      <label className="inline">
        {IMAGES.insertLabel}
        <select value={selected.name} onChange={(e) => setChoice(e.target.value)}>
          {images.map((i) => (
            <option key={i.name} value={i.name}>
              {i.label ? `${i.name} (${i.label})` : i.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" disabled={disabled} onClick={() => onInsert(imageMarkdown(selected.name, selected.label))} variant="secondary">
        {IMAGES.insertButton}
      </Button>
      <span className="small muted">{IMAGES.insertHint}</span>
    </div>
  );
}

function UnlockCheckbox({
  isProtected,
  checked,
  onChange,
}: {
  isProtected: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  if (!isProtected) return null;
  return (
    <label className="inline">
      <input type="checkbox" name="unlockProtected" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
      {RECORD.unlockProtected}
    </label>
  );
}

export function RecordEditor(props: {
  projectId: string;
  recordId: string;
  recordType: RecordType;
  revision: number;
  title: string;
  body: string;
  fieldsJson: string;
  authorityStatus: AuthorityStatus;
  isProtected: boolean;
  isChapter: boolean;
  otherChaptersWords: number | null;
  spellingLanguage: SpellingLanguage;
  spellChecker: SpellChecker;
  dictionaryWords: DictionaryWord[];
  proofread: ProofreadConfig;
  /** Images attached to this reference document, for Insert image. */
  images?: { name: string; label: string }[];
  codexEntries?: CodexEntry[];
  kindTemplates?: readonly KindTemplateView[];
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    saveRecordAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // The text box reports line endings as "\n"; keep offsets in the same terms.
  const savedText = normalizeNewlines(props.body);
  const [text, setText] = useState(savedText);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [unlocked, setUnlocked] = useState(false);
  const [unlockedRevision, setUnlockedRevision] = useState(props.revision);
  const [language, setLanguage] = useState(props.spellingLanguage);
  const [directUndo, setDirectUndo] = useState<DirectUndo[]>([]);
  const [checker, setChecker] = useState(props.spellChecker);
  const [words, setWords] = useState(props.dictionaryWords);
  const editable = !props.isProtected || unlocked;

  const spell = useSpellcheck({ enabled: checker === "app", language, text, words });
  // If the app's checker cannot start, the browser's checker takes over so the text is still checked.
  const appUnderlines = checker === "app" && spell.status !== "error";
  const { flagsFor } = spell;
  const flags = useMemo(() => (appUnderlines ? flagsFor(text) : []), [appUnderlines, flagsFor, text]);
  // The underlines may trail fast typing by a moment, so typing itself never waits for them.
  const overlayText = useDeferredValue(text);
  const overlayFlags = useMemo(() => (appUnderlines ? flagsFor(overlayText) : []), [appUnderlines, flagsFor, overlayText]);

  const [title, setTitle] = useState(props.title);
  const [fields, setFields] = useState(props.fieldsJson);
  const [fieldsValid, setFieldsValid] = useState(true);
  const [templateKey, setTemplateKey] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [headingNotice, setHeadingNotice] = useState("");
  const onValidity = useCallback((valid: boolean) => setFieldsValid(valid), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  if (unlockedRevision !== props.revision) {
    setUnlockedRevision(props.revision);
    setUnlocked(false);
  }

  const dirty = text !== savedText || title.trim() !== props.title.trim() || sameJson(fields, props.fieldsJson) === false;
  const unsavedKey = `record-editor-${props.recordId}`;
  useEffect(() => {
    setUnsaved(unsavedKey, dirty);
    return () => setUnsaved(unsavedKey, false);
  }, [unsavedKey, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const readSelection = () => {
    const ta = bodyRef.current;
    if (ta) setSelection({ start: ta.selectionStart, end: ta.selectionEnd });
  };

  useEffect(() => {
    const onChange = () => {
      if (document.activeElement === bodyRef.current) readSelection();
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const baseline = useMemo(
    () => ({ title: props.title, body: savedText, fields: props.fieldsJson }),
    [props.title, savedText, props.fieldsJson],
  );
  const currentDraft = useMemo(() => ({ title, body: text, fields }), [title, text, fields]);
  const recovery = useLocalRecovery({
    recordId: props.recordId,
    revision: props.revision,
    baseline,
    current: currentDraft,
    enabled: true,
    saved: state.ok && Boolean(state.message) && !dirty,
    onRestore: (draft) => {
      setTitle(draft.title);
      setText(normalizeNewlines(draft.body));
      setFields(draft.fields);
      const titleInput = bodyRef.current?.form?.querySelector<HTMLInputElement>('input[name="title"]');
      if (titleInput) titleInput.value = draft.title;
      const body = bodyRef.current;
      if (body) {
        body.value = draft.body;
        const end = body.value.length;
        body.setSelectionRange(end, end);
        setSelection({ start: end, end });
      }
    },
  });

  const onBodyInput = (e: FormEvent<HTMLTextAreaElement>) => {
    setText(e.currentTarget.value);
    readSelection();
    if (e.nativeEvent.isTrusted && directUndo.length > 0) setDirectUndo([]);
  };

  const selectedTemplate = isReferenceTemplateKey(templateKey) ? templateKey : null;
  const readHref = `/projects/${encodeURIComponent(props.projectId)}/records/${encodeURIComponent(props.recordId)}`;

  if (isWorldType(props.recordType)) {
    return (
      <form
        id="reference-editor"
        className="reference-composer stack"
        onSubmit={(event) => {
          if (!fieldsValid || !editable) {
            event.preventDefault();
            return;
          }
          submitWithoutReset(action)(event);
        }}
      >
        <RecoveryBanner pending={recovery.pending} onRestore={recovery.restore} onDiscard={recovery.discard} />
        <input type="hidden" name="expectedRevision" value={props.revision} />
        <input type="hidden" name="fields" value={fields} />
        <div className="reference-edit-bar">
          <p className="reference-save-status" role="status">
            {props.isProtected && !unlocked ? REFERENCE_FORM.protected : null}
            {props.isProtected && unlocked ? REFERENCE_FORM.editingEnabled : null}
            {dirty ? ` ${REFERENCE_FORM.unsaved}` : ""}
            {pending ? ` ${REFERENCE_FORM.saving}` : ""}
            {state.ok && state.message && !dirty ? ` ${REFERENCE_FORM.saved}` : ""}
            {state.ok === false ? ` ${REFERENCE_FORM.failed}` : ""}
          </p>
          <div className="reference-save-actions">
            <Button type="submit" disabled={pending || !fieldsValid || !editable}>
              {REFERENCE_FORM.save}
            </Button>
            <ButtonLink
              href={readHref}
              variant="secondary"
              onClick={(event) => {
                if (dirty && !window.confirm(WRITE.leaveUnsaved)) event.preventDefault();
              }}
            >
              {REFERENCE_FORM.cancel}
            </ButtonLink>
          </div>
        </div>
        {props.isProtected ? (
          <UnlockCheckbox key={props.revision} isProtected={props.isProtected} checked={unlocked} onChange={setUnlocked} />
        ) : null}
        <p className="small muted">{REFERENCE_FORM.typeReadOnly}</p>
        <div className="reference-composer-grid">
          <label className="reference-title-field">
            {REFERENCE_FORM.title}
            <input
              type="text"
              name="title"
              defaultValue={props.title}
              required
              spellCheck
              lang={language}
              disabled={!editable}
              onInput={(e) => setTitle(e.currentTarget.value)}
            />
          </label>
          {props.recordType === "character_dossier" || props.recordType === "canon_decision" || props.recordType === "continuity_note" ? (
            <ReferenceMetaFields recordType={props.recordType} fieldsJson={fields} onFieldsJsonChange={setFields} disabled={!editable} />
          ) : null}
          <WorldKindFields
            fieldsJson={fields}
            onFieldsJsonChange={setFields}
            onValidityChange={onValidity}
            disabled={!editable}
            showKind={props.recordType === "worldbuilding"}
            projectId={props.projectId}
            kindTemplates={props.kindTemplates}
          />
          <div className="reference-headings stack">
            <label>
              {REFERENCE_FORM.headings}
              <select value={templateKey} disabled={!editable} onChange={(event) => setTemplateKey(event.target.value)}>
                <option value="">{REFERENCE_FORM.headingsNone}</option>
                {REFERENCE_TEMPLATES.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="secondary" disabled={!editable || !selectedTemplate} onClick={() => setPreviewOpen(true)}>
              {REFERENCE_FORM.reviewHeadings}
            </Button>
          </div>
          <div className="reference-writing-field stack">
            <div className="writing-tools stack">
              <div className="row">
                <strong>{WRITING.toolsHeading}</strong>
                <SpellingLanguageSelect value={language} onChange={setLanguage} />
              </div>
              <SpellingPanel
                projectId={props.projectId}
                checker={checker}
                onCheckerChange={setChecker}
                spell={spell}
                flags={flags}
                text={text}
                selection={selection}
                textareaRef={bodyRef}
                editable={editable}
                onUnlock={() => setUnlocked(true)}
                words={words}
                onWordsChange={setWords}
                onDirectEdit={(before, edit) =>
                  setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }])
                }
              />
              <FindReplace
                textareaRef={bodyRef}
                text={text}
                selection={selection}
                canReplace={editable}
                onUnlock={() => setUnlocked(true)}
                directUndo={directUndo}
                onDirectUndoChange={setDirectUndo}
              />
            </div>
            <label>
              {REFERENCE_FORM.writing}
              <span className="spell-field">
                <textarea
                  ref={bodyRef}
                  name="body"
                  className="document"
                  defaultValue={props.body}
                  style={{ minHeight: "16rem" }}
                  spellCheck={!appUnderlines}
                  lang={language}
                  readOnly={!editable}
                  placeholder={REFERENCE_FORM.writingPlaceholder}
                  onInput={onBodyInput}
                  onSelect={readSelection}
                  onKeyUp={readSelection}
                  onMouseUp={readSelection}
                />
                {appUnderlines ? (
                  <SpellOverlay textareaRef={bodyRef} text={overlayText} flags={overlayFlags} current={flagAt(overlayFlags, selection)} />
                ) : null}
              </span>
            </label>
            {headingNotice ? (
              <p className="small" role="status">
                {headingNotice}
              </p>
            ) : null}
          </div>
        </div>
        <div className="reference-save-row">
          <label>
            {REFERENCE_FORM.canonStatus}
            <select name="authorityStatus" defaultValue={props.authorityStatus} disabled={!editable}>
              {AUTHORITY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">{REFERENCE_FORM.draftHint}</p>
          <Button type="submit" disabled={pending || !fieldsValid || !editable}>
            {REFERENCE_FORM.save}
          </Button>
        </div>
        <Result state={state} />
        <HeadingReviewDialog
          open={previewOpen}
          templateKey={selectedTemplate}
          body={text}
          onClose={closePreview}
          onApply={(next) => {
            const ta = bodyRef.current;
            if (!ta || !editable) return;
            const before = ta.value;
            const edit = { start: 0, end: before.length, text: next };
            const how = applyTextareaEdit(ta, edit);
            setText(normalizeNewlines(ta.value));
            if (how === "direct") {
              setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }]);
            }
            setHeadingNotice(REFERENCE_FORM.addedUnsaved);
            setPreviewOpen(false);
          }}
        />
      </form>
    );
  }

  return (
    <form onSubmit={submitWithoutReset(action)} className="stack">
      <RecoveryBanner pending={recovery.pending} onRestore={recovery.restore} onDiscard={recovery.discard} />
      <input type="hidden" name="expectedRevision" value={props.revision} />
      <input type="hidden" name="authorityStatus" value={props.authorityStatus} />
      <label>
        Title
        <input type="text" name="title" defaultValue={props.title} required spellCheck lang={language} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <div className="writing-tools stack">
        <div className="row">
          <strong>{WRITING.toolsHeading}</strong>
          <SpellingLanguageSelect value={language} onChange={setLanguage} />
        </div>
        <SpellingPanel
          projectId={props.projectId}
          checker={checker}
          onCheckerChange={setChecker}
          spell={spell}
          flags={flags}
          text={text}
          selection={selection}
          textareaRef={bodyRef}
          editable={editable}
          onUnlock={() => setUnlocked(true)}
          words={words}
          onWordsChange={setWords}
          onDirectEdit={(before, edit) =>
            setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }])
          }
        />
        <HelpHint anchor="spelling" topic="spelling">
          {checker === "app"
            ? "Click an underlined word, or use Next word, to see suggestions and dictionary options."
            : "Spelling suggestions come from your browser and its settings. Right-click an underlined word to see them."}
        </HelpHint>
        <FindReplace
          textareaRef={bodyRef}
          text={text}
          selection={selection}
          canReplace={editable}
          onUnlock={() => setUnlocked(true)}
          directUndo={directUndo}
          onDirectUndoChange={setDirectUndo}
        />
        <SelectionAssister
          projectId={props.projectId}
          recordId={props.recordId}
          revision={props.revision}
          savedText={savedText}
          text={text}
          selection={selection}
          scopeDraftId=""
          textareaRef={bodyRef}
          editable={editable}
          onUnlock={() => setUnlocked(true)}
          onTextChange={setText}
          config={props.proofread}
        />
        <Proofreader
          projectId={props.projectId}
          recordId={props.recordId}
          revision={props.revision}
          savedText={savedText}
          text={text}
          selection={selection}
          textareaRef={bodyRef}
          editable={editable}
          onUnlock={() => setUnlocked(true)}
          config={props.proofread}
        />
      </div>
      {props.images?.length ? (
        <InsertImage
          images={props.images}
          disabled={!editable}
          onInsert={(markdown) => {
            const ta = bodyRef.current;
            if (!ta) return;
            const before = ta.value;
            const edit = { start: ta.selectionStart, end: ta.selectionEnd, text: markdown };
            if (applyTextareaEdit(ta, edit) === "direct") {
              setDirectUndo((stack) => [...stack, { inverse: invertEdit(before, edit), inserted: edit.text }]);
            }
          }}
        />
      ) : null}
      <label>
        {RECORD.bodyLabel}
        <span className="spell-field">
          <textarea
            ref={bodyRef}
            name="body"
            className="document"
            defaultValue={props.body}
            style={{ minHeight: "16rem" }}
            spellCheck={!appUnderlines}
            lang={language}
            onInput={onBodyInput}
            onSelect={readSelection}
            onKeyUp={readSelection}
            onMouseUp={readSelection}
          />
          {appUnderlines ? (
            <SpellOverlay textareaRef={bodyRef} text={overlayText} flags={overlayFlags} current={flagAt(overlayFlags, selection)} />
          ) : null}
        </span>
        <CodexSuggestBox
          entries={(props.codexEntries ?? []).filter((entry) => entry.id !== props.recordId)}
          text={text}
          cursor={selection.start}
          onApply={(next) => {
            const body = bodyRef.current;
            if (!body) return;
            body.value = next.text;
            setText(normalizeNewlines(next.text));
            body.setSelectionRange(next.cursor, next.cursor);
            setSelection({ start: next.cursor, end: next.cursor });
          }}
        />
      </label>
      <WordCounts
        text={text}
        selection={selection}
        isChapter={props.isChapter}
        otherChaptersWords={props.otherChaptersWords}
      />
      <label>
        {RECORD.fieldsLabel}
        <textarea
          name="fields"
          className="mono"
          value={fields}
          style={{ minHeight: "6rem" }}
          spellCheck={false}
          onInput={(e) => setFields(e.currentTarget.value)}
        />
      </label>
      <UnlockCheckbox key={props.revision} isProtected={props.isProtected} checked={unlocked} onChange={setUnlocked} />
      <Result state={state} />
      <div className="row">
        <Button type="submit" disabled={pending}>
          {RECORD.saveAsRevision(props.revision + 1)}
        </Button>
        <span className="small muted">Editing revision {props.revision}. Newer saves elsewhere will be detected.</span>
      </div>
    </form>
  );
}

export function StatusForm(props: {
  projectId: string;
  recordId: string;
  revision: number;
  status: AuthorityStatus;
  isProtected: boolean;
}) {
  const [state, action, pending] = useActionState<FormResult, FormData>(
    setStatusAction.bind(null, props.projectId, props.recordId),
    { ok: true },
  );

  return (
    <form onSubmit={submitWithoutReset(action)} className="stack">
      <input type="hidden" name="expectedRevision" value={props.revision} />
      <div className="row">
        <label>
          Status
          <select name="status" defaultValue={props.status}>
            {AUTHORITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label style={{ flex: 1 }}>
          {RECORD.supersededByLabel}
          <input type="text" name="supersededBy" placeholder="rec_..." spellCheck={false} />
        </label>
      </div>
      <UnlockCheckbox key={props.revision} isProtected={props.isProtected} />
      <Result state={state} />
      <div>
        <Button type="submit" disabled={pending} variant="secondary">
          {RECORD.updateStatus}
        </Button>
      </div>
    </form>
  );
}
