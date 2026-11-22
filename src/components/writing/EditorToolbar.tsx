"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import {
  Bold,
  Ellipsis,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Search,
  SpellCheck,
  Undo2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TextAppearanceMenu } from "@/components/TextAppearanceMenu";
import { STYLE_CHECK, WRITE } from "@/ui/labels";
import {
  blockState,
  inlineState,
  insertLink,
  insertSceneBreak,
  linkAt,
  setBlockStyle,
  toggleInline,
  toggleList,
  type BlockStyle,
  type FormatResult,
  type Selection,
} from "@/writing/markdownFormat";

export type FormatCommand = (text: string, sel: Selection) => FormatResult;

/** Shortcut text for tooltips. The same keys work with Cmd on a Mac. */
export function shortcutHint(key: string, shift = false): string {
  return `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

export interface LinkSeed {
  url: string;
  label: string;
}

/** What the link form starts with: the link the selection is in, or the selected words. Read from the editor itself. */
export function linkSeedFrom(editor: { value: string; selectionStart: number; selectionEnd: number }): LinkSeed {
  const text = editor.value;
  const sel = { start: editor.selectionStart, end: editor.selectionEnd };
  const existing = linkAt(text, sel);
  return existing ? { url: existing.url, label: existing.label } : { url: "", label: text.slice(sel.start, sel.end) };
}

/** Keeps the text box focused, with its selection, when a toolbar button is clicked. */
const keepSelection = (e: MouseEvent) => e.preventDefault();

function ToolButton({
  label,
  shortcut,
  ariaShortcut,
  pressed,
  expanded,
  controls,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  ariaShortcut?: string;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className="tool-button tip"
      aria-label={label}
      data-tooltip={tip}
      aria-keyshortcuts={ariaShortcut}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Left and right arrow keys move between toolbar buttons, as in a desktop toolbar. */
function onToolbarKey(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (!(e.target instanceof HTMLButtonElement)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].filter(
    (b) => b.offsetParent !== null && !b.closest(".tool-menu, .text-appearance"),
  );
  const i = buttons.indexOf(e.target);
  if (i < 0) return;
  e.preventDefault();
  buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length].focus();
}

export function EditorToolbar({
  editorId,
  textareaRef,
  text,
  selection,
  editable,
  onFormat,
  onHistory,
  findId,
  findOpen,
  onToggleFind,
  spellId,
  spellOpen,
  onToggleSpell,
  styleId,
  styleOpen,
  onToggleStyle,
  linkRequest,
  readAloud,
}: {
  editorId: string;
  textareaRef: RefObject<import("./EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  text: string;
  selection: Selection;
  editable: boolean;
  onFormat: (command: FormatCommand) => void;
  onHistory: () => void;
  findId: string;
  findOpen: boolean;
  onToggleFind: () => void;
  spellId: string;
  spellOpen: boolean;
  onToggleSpell: () => void;
  styleId: string;
  styleOpen: boolean;
  onToggleStyle: () => void;
  /** Set when the link shortcut is pressed in the text box; `id` changes on every press. */
  linkRequest: (LinkSeed & { id: number }) | null;
  /** Browser speech for the selection or whole scene. Lives in the toolbar so it is not covered by sticky chrome. */
  readAloud?: {
    supported: boolean;
    speaking: boolean;
    onToggle: () => void;
  } | null;
}) {
  const idPrefix = useId();
  const inline = inlineState(text, selection);
  const block = blockState(text, selection);
  const currentLink = linkAt(text, selection);
  const [link, setLink] = useState<LinkSeed | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [seenLinkRequest, setSeenLinkRequest] = useState(linkRequest?.id ?? 0);
  const disabled = !editable;
  const linkOpen = link !== null;

  if (linkRequest && linkRequest.id !== seenLinkRequest) {
    setSeenLinkRequest(linkRequest.id);
    if (editable) setLink({ url: linkRequest.url, label: linkRequest.label });
  }

  const toggleLink = () => {
    const ta = textareaRef.current;
    setLink(linkOpen || !ta ? null : linkSeedFrom(ta));
  };

  const runOnText = (command: FormatCommand) => {
    onFormat(command);
    setMoreOpen(false);
  };

  const undoRedo = (command: "undo" | "redo") => {
    const editor = textareaRef.current;
    if (!editor) return;
    editor.focus();
    if (command === "undo" && "undo" in editor && typeof editor.undo === "function" && editor.undo()) {
      onHistory();
      return;
    }
    if (command === "redo" && "redo" in editor && typeof editor.redo === "function" && editor.redo()) {
      onHistory();
      return;
    }
    if (typeof HTMLTextAreaElement !== "undefined" && editor instanceof HTMLTextAreaElement) {
      document.execCommand(command);
    }
    onHistory();
  };

  return (
    <div className="editor-toolbar-wrap">
      <div role="toolbar" aria-label={WRITE.toolbar} aria-controls={editorId} className="editor-toolbar" onKeyDown={onToolbarKey}>
        <label className="tool-select">
          <span className="sr-only">{WRITE.paragraphStyle}</span>
          <select
            value={block.style}
            disabled={disabled}
            onChange={(e) => onFormat((t, s) => setBlockStyle(t, s, e.target.value as BlockStyle))}
          >
            <option value="paragraph">{WRITE.paragraph}</option>
            <option value="h1">{WRITE.heading(1)}</option>
            <option value="h2">{WRITE.heading(2)}</option>
            <option value="h3">{WRITE.heading(3)}</option>
            <option value="quote">{WRITE.quote}</option>
            {block.style === "other" ? (
              <option value="other" disabled>
                {WRITE.heading(4)}+
              </option>
            ) : null}
          </select>
        </label>
        <span className="tool-sep" aria-hidden="true" />
        <ToolButton
          label={WRITE.bold}
          shortcut={shortcutHint("B")}
          ariaShortcut="Control+B"
          pressed={inline.bold}
          disabled={disabled}
          onClick={() => onFormat((t, s) => toggleInline(t, s, "bold"))}
        >
          <Bold strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label={WRITE.italic}
          shortcut={shortcutHint("I")}
          ariaShortcut="Control+I"
          pressed={inline.italic}
          disabled={disabled}
          onClick={() => onFormat((t, s) => toggleInline(t, s, "italic"))}
        >
          <Italic strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label={WRITE.bulletList}
          pressed={block.list === "bullet"}
          disabled={disabled}
          onClick={() => onFormat((t, s) => toggleList(t, s, "bullet"))}
        >
          <List strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label={WRITE.numberedList}
          pressed={block.list === "number"}
          disabled={disabled}
          onClick={() => onFormat((t, s) => toggleList(t, s, "number"))}
        >
          <ListOrdered strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label={WRITE.link}
          shortcut={shortcutHint("K")}
          ariaShortcut="Control+K"
          pressed={currentLink !== null}
          expanded={linkOpen}
          controls={`${idPrefix}-link`}
          disabled={disabled}
          onClick={toggleLink}
        >
          <Link2 strokeWidth={1.75} />
        </ToolButton>
        <span className="tool-sep" aria-hidden="true" />
        <ToolButton label={WRITE.undo} shortcut={shortcutHint("Z")} ariaShortcut="Control+Z" onClick={() => undoRedo("undo")}>
          <Undo2 strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          label={WRITE.redo}
          shortcut={shortcutHint("Y")}
          ariaShortcut="Control+Y"
          onClick={() => undoRedo("redo")}
        >
          <Redo2 strokeWidth={1.75} />
        </ToolButton>
        <span className="tool-sep" aria-hidden="true" />
        <Button
          type="button"
          variant="toolbar"
          size="toolbar"
          className="tool-labeled"
          aria-label={WRITE.find}
          title={`${WRITE.find} (${shortcutHint("F")})`}
          aria-keyshortcuts="Control+F"
          aria-expanded={findOpen}
          aria-controls={findId}
          onMouseDown={keepSelection}
          onClick={onToggleFind}
          icon={<Search strokeWidth={1.75} />}
        >
          {WRITE.find}
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="toolbar"
          className="tool-labeled"
          aria-label={WRITE.spellcheck}
          aria-expanded={spellOpen}
          aria-controls={spellId}
          onMouseDown={keepSelection}
          onClick={onToggleSpell}
          icon={<SpellCheck strokeWidth={1.75} />}
        >
          {WRITE.spellcheck}
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="toolbar"
          className="tool-labeled"
          aria-label={STYLE_CHECK.toolbar}
          aria-expanded={styleOpen}
          aria-controls={styleId}
          onMouseDown={keepSelection}
          onClick={onToggleStyle}
          icon={<ListChecks strokeWidth={1.75} />}
        >
          {STYLE_CHECK.toolbar}
        </Button>
        <TextAppearanceMenu presentation="toolbar" />
        {readAloud?.supported ? (
          <Button
            type="button"
            variant="toolbar"
            size="toolbar"
            className="tool-labeled"
            aria-label={readAloud.speaking ? WRITE.readAloudStop : WRITE.readAloud}
            aria-pressed={readAloud.speaking}
            title={readAloud.speaking ? WRITE.readAloudStop : WRITE.readAloud}
            onMouseDown={keepSelection}
            onClick={readAloud.onToggle}
            icon={readAloud.speaking ? <VolumeX strokeWidth={1.75} /> : <Volume2 strokeWidth={1.75} />}
          >
            {readAloud.speaking ? WRITE.readAloudStop : WRITE.readAloud}
          </Button>
        ) : null}
        <div className="tool-more">
          <ToolButton
            label={WRITE.moreFormatting}
            expanded={moreOpen}
            controls={`${idPrefix}-more`}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <Ellipsis strokeWidth={1.75} />
          </ToolButton>
          <div
            id={`${idPrefix}-more`}
            className="tool-menu"
            role="group"
            aria-label={WRITE.moreFormatting}
            hidden={!moreOpen}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setMoreOpen(false);
                textareaRef.current?.focus();
              }
            }}
          >
            <button
              type="button"
              className="menu-item"
              aria-pressed={block.style === "quote"}
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => runOnText((t, s) => setBlockStyle(t, s, block.style === "quote" ? "paragraph" : "quote"))}
            >
              {WRITE.quote}
            </button>
            <button
              type="button"
              className="menu-item"
              disabled={disabled}
              onMouseDown={keepSelection}
              onClick={() => runOnText(insertSceneBreak)}
            >
              {WRITE.sceneBreak}
            </button>
          </div>
        </div>
      </div>
      {disabled ? <p className="hint toolbar-hint">{WRITE.readOnlyToolbar}</p> : null}
      {link ? (
        <LinkForm
          id={`${idPrefix}-link`}
          initialUrl={link.url}
          initialLabel={link.label}
          onInsert={(url, label) => {
            setLink(null);
            onFormat((t, s) => insertLink(t, s, url, label));
          }}
          onClose={() => {
            setLink(null);
            textareaRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

/** Not a <form>: it sits inside the editor's form. Enter inserts, Escape closes. */
function LinkForm({
  id,
  initialUrl,
  initialLabel,
  onInsert,
  onClose,
}: {
  id: string;
  initialUrl: string;
  initialLabel: string;
  onInsert: (url: string, label: string) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [label, setLabel] = useState(initialLabel);
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => urlRef.current?.focus(), []);
  const submit = () => {
    if (url.trim()) onInsert(url, label);
  };
  return (
    <div
      id={id}
      className="link-form row"
      role="group"
      aria-label={WRITE.insertLink}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="inline">
        {WRITE.linkUrl}
        <input ref={urlRef} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" spellCheck={false} />
      </label>
      <label className="inline">
        {WRITE.linkText}
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <Button type="button" size="sm" onClick={submit} disabled={!url.trim()}>
        {WRITE.insertLink}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onClose}>
        {WRITE.cancel}
      </Button>
    </div>
  );
}
