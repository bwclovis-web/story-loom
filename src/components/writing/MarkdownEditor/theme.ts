import { EditorView } from "@codemirror/view";

/** Manuscript look using Story Loom design tokens (no short circular Tailwind aliases). */
export const manuscriptTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--color-text)",
      fontSize: "calc(1.125rem * var(--text-scale))",
      fontFamily: "var(--text-font)",
    },
    ".cm-content": {
      fontFamily: "var(--text-font)",
      lineHeight: "calc(1.8 * var(--text-leading))",
      padding: "0.5rem 0.75rem",
      caretColor: "var(--color-accent)",
      minHeight: "60vh",
    },
    ".cm-scroller": {
      fontFamily: "var(--text-font)",
      lineHeight: "calc(1.8 * var(--text-leading))",
      overflow: "auto",
    },
    "&.cm-focused": {
      outline: "2px solid var(--color-accent-soft-border)",
      outlineOffset: "0",
      backgroundColor: "var(--color-surface)",
      borderRadius: "var(--radius-md)",
    },
    ".cm-gutters": { display: "none" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent) !important",
    },
    ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
    ".cm-header": { fontWeight: "600" },
    ".cm-strong": { fontWeight: "700" },
    ".cm-emphasis": { fontStyle: "italic" },
    ".cm-strikethrough": { textDecoration: "line-through" },
    ".cm-link": { color: "var(--color-accent)" },
    ".cm-url": { color: "var(--color-text-muted)" },
    ".cm-quote": { color: "var(--color-text-muted)", fontStyle: "italic" },
    ".cm-hr": { color: "var(--color-border)" },
  },
  { dark: false },
);
