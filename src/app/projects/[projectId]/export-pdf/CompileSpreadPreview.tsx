"use client";

import type { CompileProfileView } from "@/server/services/compileProfileService";
import { TRIM_SIZES, spacingMetrics } from "@/writing/compileLayout";
import { BOOK_THEME_KEYS, exportTypography } from "@/writing/bookThemes";
import { COMPILE_PROFILE } from "@/ui/labels";

const FONT_STACK: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", var(--font-serif, serif)',
  sans: 'system-ui, "Segoe UI", var(--font-sans, sans-serif)',
  mono: '"Courier New", ui-monospace, monospace',
};

function sampleParagraphs(body: string, sceneBreak: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [
      "The morning light found dust on the ledger’s brass corners. She opened it anyway.",
      sceneBreak,
      "By noon the harbour smelled of rain and old ink.",
    ];
  }
  const parts = trimmed.split(/\n{2,}/).slice(0, 3);
  if (parts.length < 2) parts.push("A scene break and a second beat help you judge spacing.");
  return parts;
}

export function CompileSpreadPreview({
  profile,
  chapterTitle,
  sampleBody,
}: {
  profile: CompileProfileView;
  chapterTitle: string;
  sampleBody: string;
}) {
  const typo = exportTypography(profile);
  const spacing = spacingMetrics(typo.spacingPreset);
  const trim = TRIM_SIZES[profile.trimSize];
  const sceneBreak = profile.sceneBreakGlyph.trim() || "***";
  const paragraphs = sampleParagraphs(sampleBody, sceneBreak);
  const first = paragraphs[0] ?? "";
  const rest = paragraphs.slice(1);
  const themeLabel =
    profile.bookTheme && (BOOK_THEME_KEYS as readonly string[]).includes(profile.bookTheme)
      ? COMPILE_PROFILE.bookThemeOption(profile.bookTheme)
      : COMPILE_PROFILE.bookThemeNone;

  const shared = {
    color: "var(--color-text)",
    fontFamily: FONT_STACK[typo.fontPreset] ?? FONT_STACK.serif,
    fontSize: `${spacing.bodySize}px`,
    lineHeight: `${spacing.bodySize + spacing.lineGap}px`,
  } as const;

  return (
    <section className="stack" aria-labelledby="compile-spread-preview-heading">
      <h3 id="compile-spread-preview-heading" className="h3">
        {COMPILE_PROFILE.spreadPreviewHeading}
      </h3>
      <p className="small muted">
        {COMPILE_PROFILE.spreadPreviewIntro} {themeLabel}.
      </p>
      <div
        className="row"
        style={{
          flexWrap: "wrap",
          gap: "1.25rem",
          alignItems: "flex-start",
        }}
      >
        <figure
          className="panel"
          style={{
            flex: "1 1 280px",
            maxWidth: "100%",
            margin: 0,
            padding: "0.75rem",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <figcaption className="small muted" style={{ marginBottom: "0.5rem" }}>
            {COMPILE_PROFILE.spreadPreviewPaperback} · {trim.label}
          </figcaption>
          <div
            style={{
              ...shared,
              aspectRatio: `${trim.width} / ${trim.height}`,
              maxWidth: "220px",
              margin: "0 auto",
              padding: `${profile.marginInches * 14}px`,
              background: "var(--color-bg)",
              boxShadow: "inset 0 0 0 1px var(--color-border)",
              textAlign: typo.chapterHeadingStyle === "left" ? "left" : "center",
            }}
          >
            <p
              style={{
                fontWeight: 700,
                fontSize: `${Math.max(spacing.bodySize + 2, 13)}px`,
                margin: "0 0 0.65em",
              }}
            >
              {chapterTitle}
            </p>
            <p
              style={{
                textAlign: "left",
                margin: 0,
                textIndent: profile.firstParagraphNoIndent ? 0 : `${spacing.indent}px`,
              }}
            >
              {typo.dropCap ? (
                <>
                  <span style={{ float: "left", fontSize: "2.4em", lineHeight: 0.85, paddingRight: "0.08em" }}>
                    {first.charAt(0)}
                  </span>
                  {first.slice(1)}
                </>
              ) : (
                first
              )}
            </p>
            {rest.map((para, index) =>
              para === sceneBreak ? (
                <p key={`break-${index}`} style={{ textAlign: "center", margin: "0.75em 0", opacity: 0.85 }}>
                  {sceneBreak}
                </p>
              ) : (
                <p
                  key={`p-${index}`}
                  style={{
                    textAlign: "left",
                    margin: `${spacing.paragraphGap}px 0 0`,
                    textIndent: index === 0 && profile.firstParagraphNoIndent ? 0 : `${spacing.indent}px`,
                  }}
                >
                  {para}
                </p>
              ),
            )}
          </div>
        </figure>

        <figure
          className="panel"
          style={{
            flex: "1 1 220px",
            maxWidth: "100%",
            margin: 0,
            padding: "0.75rem",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          <figcaption className="small muted" style={{ marginBottom: "0.5rem" }}>
            {COMPILE_PROFILE.spreadPreviewEreader}
          </figcaption>
          <div
            style={{
              ...shared,
              width: "min(100%, 200px)",
              minHeight: "280px",
              margin: "0 auto",
              padding: "1rem 0.9rem",
              borderRadius: "12px",
              background: "var(--color-bg)",
              boxShadow: "0 0 0 2px var(--color-border)",
            }}
          >
            <p style={{ fontWeight: 600, fontSize: "0.95em", margin: "0 0 0.5em" }}>{chapterTitle}</p>
            <p style={{ margin: 0, textAlign: "justify", hyphens: "auto" }}>{first}</p>
            {rest.slice(0, 1).map((para) =>
              para === sceneBreak ? (
                <p key="e-break" style={{ textAlign: "center", margin: "0.6em 0", opacity: 0.75, fontSize: "0.85em" }}>
                  {sceneBreak}
                </p>
              ) : (
                <p key="e-p" style={{ margin: "0.5em 0 0", textAlign: "justify" }}>
                  {para}
                </p>
              ),
            )}
          </div>
        </figure>
      </div>
    </section>
  );
}