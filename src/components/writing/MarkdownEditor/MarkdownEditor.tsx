"use client";

import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { SpellFlag } from "@/spelling/dictionary";
import type { CodexEntry } from "@/writing/codexSuggest";
import type { EditorSurface } from "../EditorSurface";
import { codexHoverExtension } from "./codexHover";
import { livePreviewExtension } from "./livePreview";
import { setSpellFlagsEffect, spellDecorationExtension } from "./spellDecorations";
import { manuscriptTheme } from "./theme";

export type EditorChrome = "live" | "raw";

export interface MarkdownEditorProps {
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  initialDoc: string;
  editable?: boolean;
  language?: string;
  chrome?: EditorChrome;
  placeholder?: string;
  spellFlags?: readonly SpellFlag[];
  currentSpellFlag?: SpellFlag | null;
  codexEntries?: readonly CodexEntry[];
  onChange?: (doc: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onDomKeyDown?: (event: KeyboardEvent) => void;
}

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--color-accent)" },
  { tag: tags.url, color: "var(--color-text-muted)" },
  { tag: tags.quote, color: "var(--color-text-muted)", fontStyle: "italic" },
  { tag: tags.monospace, fontFamily: "var(--font-mono, ui-monospace, monospace)" },
]);

function createSurface(view: EditorView, host: HTMLElement): EditorSurface {
  return {
    get value() {
      return view.state.doc.toString();
    },
    set value(next: string) {
      const current = view.state.doc.toString();
      if (current === next) return;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: next },
        userEvent: "input",
      });
    },
    get selectionStart() {
      return view.state.selection.main.from;
    },
    get selectionEnd() {
      return view.state.selection.main.to;
    },
    setSelectionRange(start, end) {
      const len = view.state.doc.length;
      const from = Math.max(0, Math.min(start, len));
      const to = Math.max(0, Math.min(end, len));
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    },
    focus(options) {
      if (options?.preventScroll) view.contentDOM.focus({ preventScroll: true });
      else view.focus();
    },
    blur() {
      view.contentDOM.blur();
    },
    get scrollTop() {
      return view.scrollDOM.scrollTop;
    },
    set scrollTop(value: number) {
      view.scrollDOM.scrollTop = value;
    },
    get clientHeight() {
      return view.scrollDOM.clientHeight;
    },
    get clientWidth() {
      return view.scrollDOM.clientWidth;
    },
    applyEdit(edit) {
      const len = view.state.doc.length;
      const from = Math.max(0, Math.min(edit.start, len));
      const to = Math.max(from, Math.min(edit.end, len));
      const insert = edit.text;
      view.focus();
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.type",
      });
      return "native";
    },
    undo() {
      return undo(view);
    },
    redo() {
      return redo(view);
    },
    containsElement(el) {
      return el instanceof Node && host.contains(el);
    },
  };
}

export const MarkdownEditor = forwardRef<EditorSurface, MarkdownEditorProps>(function MarkdownEditor(
  {
    id,
    className,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
    initialDoc,
    editable = true,
    language = "en",
    chrome = "live",
    placeholder,
    spellFlags = [],
    currentSpellFlag = null,
    codexEntries = [],
    onChange,
    onSelectionChange,
    onDomKeyDown,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const surfaceRef = useRef<EditorSurface | null>(null);
  const chromeCompartment = useRef(new Compartment());
  const editableCompartment = useRef(new Compartment());
  const attrsCompartment = useRef(new Compartment());
  const codexCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onKeyDownRef = useRef(onDomKeyDown);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;
  onKeyDownRef.current = onDomKeyDown;

  useImperativeHandle(ref, () => {
    const live = () => surfaceRef.current;
    return {
      get value() {
        return live()?.value ?? "";
      },
      set value(next: string) {
        const surface = live();
        if (surface) surface.value = next;
      },
      get selectionStart() {
        return live()?.selectionStart ?? 0;
      },
      get selectionEnd() {
        return live()?.selectionEnd ?? 0;
      },
      setSelectionRange(start, end, direction) {
        live()?.setSelectionRange(start, end, direction);
      },
      focus(options) {
        live()?.focus(options);
      },
      blur() {
        live()?.blur?.();
      },
      get scrollTop() {
        return live()?.scrollTop ?? 0;
      },
      set scrollTop(value: number) {
        const surface = live();
        if (surface) surface.scrollTop = value;
      },
      get clientHeight() {
        return live()?.clientHeight ?? 0;
      },
      get clientWidth() {
        return live()?.clientWidth ?? 0;
      },
      applyEdit(edit) {
        return live()?.applyEdit?.(edit) ?? "direct";
      },
      undo() {
        return live()?.undo?.() ?? false;
      },
      redo() {
        return live()?.redo?.() ?? false;
      },
      containsElement(el) {
        return live()?.containsElement?.(el) ?? false;
      },
    };
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        markdown(),
        drawSelection(),
        syntaxHighlighting(mdHighlight),
        manuscriptTheme,
        spellDecorationExtension(),
        chromeCompartment.current.of(livePreviewExtension(chrome === "live")),
        codexCompartment.current.of(codexHoverExtension(codexEntries)),
        editableCompartment.current.of(EditorView.editable.of(editable)),
        attrsCompartment.current.of(
          EditorView.contentAttributes.of({
            id: id ?? "",
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": ariaLabel ?? "",
            "aria-describedby": ariaDescribedBy ?? "",
            lang: language,
            spellcheck: "false",
          }),
        ),
        keymap.of([...historyKeymap, ...defaultKeymap, ...searchKeymap]),
        EditorView.lineWrapping,
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            onSelectionRef.current?.({ start: sel.from, end: sel.to });
          }
        }),
        EditorView.domEventHandlers({
          keydown(event) {
            onKeyDownRef.current?.(event);
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    surfaceRef.current = createSurface(view, host);
    view.dispatch({
      effects: setSpellFlagsEffect.of({ flags: spellFlags, current: currentSpellFlag }),
    });

    return () => {
      view.destroy();
      viewRef.current = null;
      surfaceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; updates via compartments
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: chromeCompartment.current.reconfigure(livePreviewExtension(chrome === "live")),
    });
  }, [chrome]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(EditorView.editable.of(editable)),
    });
  }, [editable]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: attrsCompartment.current.reconfigure(
        EditorView.contentAttributes.of({
          id: id ?? "",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": ariaLabel ?? "",
          "aria-describedby": ariaDescribedBy ?? "",
          lang: language,
          spellcheck: "false",
        }),
      ),
    });
  }, [id, ariaLabel, ariaDescribedBy, language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setSpellFlagsEffect.of({ flags: spellFlags, current: currentSpellFlag }),
    });
  }, [spellFlags, currentSpellFlag]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: codexCompartment.current.reconfigure(codexHoverExtension(codexEntries)),
    });
  }, [codexEntries]);

  return (
    <div
      ref={hostRef}
      className={`markdown-editor manuscript-text ${className ?? ""}`.trim()}
      data-chrome={chrome}
    />
  );
});
