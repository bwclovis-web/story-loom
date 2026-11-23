"use client";

import { useMemo, useState } from "react";
import { CanonBadge } from "@/components/Badges";
import type { AuthorityStatus } from "@/domain/statuses";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { Banner } from "@/components/ui/Banner";
import { PDF } from "@/ui/labels";

export interface PdfPickerGroup {
  type: string;
  label: string;
  records: {
    id: string;
    title: string;
    authorityStatus: AuthorityStatus;
    imageCount: number;
    homeLabel?: string | null;
  }[];
}

export interface PdfPickerBook {
  id: string;
  title: string;
}

export interface PdfPickerStoryPoint {
  id: string;
  title: string;
  bookId: string;
  bookTitle: string;
}

/** A plain GET form, so the browser downloads the file and the page stays as it is. */
export function PdfReferencePicker({
  action,
  docxAction,
  epubAction,
  markdownAction,
  wikiAction,
  spoilerChapters = [],
  seriesBooks = [],
  groups,
  initialSelection,
  collectionId = null,
  collectionTitle = null,
  collectionMatchCount = null,
  hiddenScope = {},
}: {
  action: string;
  docxAction: string;
  epubAction: string;
  markdownAction: string;
  wikiAction: string;
  spoilerChapters?: PdfPickerStoryPoint[];
  seriesBooks?: PdfPickerBook[];
  groups: PdfPickerGroup[];
  initialSelection: string[];
  collectionId?: string | null;
  collectionTitle?: string | null;
  collectionMatchCount?: number | null;
  /** Taxonomy / collection scope carried from World Hub into every download. */
  hiddenScope?: {
    category?: string | null;
    subcategory?: string | null;
    tag?: string | null;
    customKind?: string | null;
    unclassified?: boolean;
  };
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  /** Once the author changes ticks under a collection, submit an explicit override. */
  const [selectionEdited, setSelectionEdited] = useState(false);
  const [exportMode, setExportMode] = useState<"full" | "point">("full");
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [spoilerBefore, setSpoilerBefore] = useState("");
  const [bookId, setBookId] = useState(seriesBooks[0]?.id ?? "");

  const toggle = (ids: string[], on: boolean) => {
    if (collectionId) setSelectionEdited(true);
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const submitCollectionLive = Boolean(collectionId) && !selectionEdited;
  const submitSelectionOverride = Boolean(collectionId) && selectionEdited;

  const scopeSummary = useMemo(() => {
    const parts: string[] = [];
    if (collectionTitle) {
      if (collectionMatchCount === 0) {
        parts.push(`Collection “${collectionTitle}” currently matches 0 references`);
      } else if (submitSelectionOverride) {
        parts.push(
          selected.size === 0
            ? `Collection “${collectionTitle}” · explicit empty selection`
            : `Collection “${collectionTitle}” · ${selected.size} of ${collectionMatchCount ?? "live"} selected`,
        );
      } else {
        parts.push(`Collection “${collectionTitle}” (${collectionMatchCount ?? "live"} matches)`);
      }
    }
    if (hiddenScope.category) {
      parts.push(
        hiddenScope.subcategory
          ? `Taxonomy ${hiddenScope.category} / ${hiddenScope.subcategory}`
          : `Taxonomy ${hiddenScope.category}`,
      );
    }
    if (hiddenScope.tag) parts.push(`Tag ${hiddenScope.tag}`);
    if (hiddenScope.customKind) parts.push(`Custom kind ${hiddenScope.customKind}`);
    if (hiddenScope.unclassified) parts.push("Unclassified only");
    if (exportMode === "full") {
      parts.push(approvedOnly ? "Full author export · approved only" : "Full author export");
    } else {
      const point = spoilerChapters.find((c) => c.id === spoilerBefore);
      const pointLabel = point
        ? `${point.bookTitle} · ${point.title}`
        : "unanchored story point";
      const book = seriesBooks.find((b) => b.id === bookId)?.title;
      parts.push(
        `Point-scoped as of “${pointLabel}”${book ? ` · viewing ${book}` : ""}${
          approvedOnly || exportMode === "point" ? " · approved only" : ""
        }`,
      );
    }
    return parts.join(" · ");
  }, [
    approvedOnly,
    bookId,
    collectionMatchCount,
    collectionTitle,
    exportMode,
    hiddenScope,
    selected.size,
    seriesBooks,
    spoilerBefore,
    spoilerChapters,
    submitSelectionOverride,
  ]);

  const liveCollectionOk = submitCollectionLive && (collectionMatchCount ?? 0) > 0;
  const canDownload =
    selected.size > 0 ||
    liveCollectionOk ||
    Boolean(hiddenScope.category) ||
    Boolean(hiddenScope.unclassified);

  const downloadCount = submitCollectionLive
    ? collectionMatchCount || 0
    : selected.size || collectionMatchCount || 0;

  return (
    <form method="get" action={action} className="stack pdf-picker">
      <input type="hidden" name="kind" value="references" />
      {collectionId ? <input type="hidden" name="collection" value={collectionId} /> : null}
      {submitSelectionOverride ? <input type="hidden" name="selectionOverride" value="1" /> : null}
      {hiddenScope.category ? <input type="hidden" name="category" value={hiddenScope.category} /> : null}
      {hiddenScope.subcategory ? (
        <input type="hidden" name="subcategory" value={hiddenScope.subcategory} />
      ) : null}
      {hiddenScope.tag ? <input type="hidden" name="tag" value={hiddenScope.tag} /> : null}
      {hiddenScope.customKind ? (
        <input type="hidden" name="customKind" value={hiddenScope.customKind} />
      ) : null}
      {hiddenScope.unclassified ? <input type="hidden" name="unclassified" value="1" /> : null}
      <input type="hidden" name="mode" value={exportMode} />
      {approvedOnly || exportMode === "point" ? (
        <input type="hidden" name="ceiling" value="approved" />
      ) : null}
      {exportMode === "point" && spoilerBefore ? (
        <input type="hidden" name="spoilerBefore" value={spoilerBefore} />
      ) : null}
      {exportMode === "point" && bookId ? <input type="hidden" name="book" value={bookId} /> : null}

      {collectionTitle ? (
        <Banner tone={collectionMatchCount === 0 ? "warn" : "info"}>
          {collectionMatchCount === 0
            ? PDF.collectionEmpty(collectionTitle)
            : submitSelectionOverride
              ? selected.size === 0
                ? PDF.collectionOverrideEmpty(collectionTitle)
                : PDF.collectionOverrideBanner(collectionTitle, selected.size, collectionMatchCount ?? 0)
              : PDF.collectionBanner(collectionTitle, collectionMatchCount ?? 0)}
        </Banner>
      ) : null}

      <fieldset className="stack panel">
        <legend className="h3">{PDF.exportScopeHeading}</legend>
        <RadioGroup
          legend={PDF.exportModeLegend}
          name="exportModeUi"
          value={exportMode}
          onValueChange={(value) => {
            const next = value === "point" ? "point" : "full";
            setExportMode(next);
            if (next === "point") setApprovedOnly(true);
          }}
          options={[
            { value: "full", label: PDF.exportModeFull },
            { value: "point", label: PDF.exportModePoint },
          ]}
        />
        {exportMode === "point" ? (
          <>
            {seriesBooks.length > 1 ? (
              <label className="stack">
                <span>{PDF.exportViewingBook}</span>
                <select className="input" value={bookId} onChange={(e) => setBookId(e.target.value)}>
                  {seriesBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {spoilerChapters.length ? (
              <label className="stack">
                <span>{PDF.wikiSpoilerBefore}</span>
                <select
                  className="input"
                  value={spoilerBefore}
                  onChange={(e) => setSpoilerBefore(e.target.value)}
                >
                  <option value="">{PDF.wikiSpoilerBeforeNone}</option>
                  {spoilerChapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.bookTitle} · {chapter.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        <Checkbox
          checked={approvedOnly || exportMode === "point"}
          disabled={exportMode === "point"}
          onChange={(e) => setApprovedOnly(e.target.checked)}
          label={PDF.wikiSpoilerApproved}
        />
        <p className="small muted" role="status">
          {PDF.exportScopeSummary(scopeSummary)}
        </p>
        <p className="small muted">{PDF.exportScopeNote}</p>
      </fieldset>

      {groups.map((group) => {
        const ids = group.records.map((r) => r.id);
        const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
        return (
          <fieldset key={group.type} className="panel">
            <legend className="sr-only">{group.label}</legend>
            <Checkbox
              className="pdf-group-label"
              checked={allOn}
              onChange={(e) => toggle(ids, e.target.checked)}
              aria-label={PDF.selectAll(group.label)}
              label={
                <>
                  {group.label} <span className="small muted">({group.records.length})</span>
                </>
              }
            />
            <div className="stack pdf-group-items">
              {group.records.map((r) => (
                <Checkbox
                  key={r.id}
                  {...(submitCollectionLive ? {} : { name: "record", value: r.id })}
                  checked={selected.has(r.id)}
                  onChange={(e) => toggle([r.id], e.target.checked)}
                  label={
                    <>
                      {r.title} <CanonBadge status={r.authorityStatus} />
                      {r.homeLabel ? <span className="small muted"> · {r.homeLabel}</span> : null}
                      {r.imageCount ? (
                        <span className="small muted">{PDF.imageCount(r.imageCount)}</span>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          </fieldset>
        );
      })}
      <div className="row">
        <button type="submit" disabled={!canDownload}>
          {PDF.downloadReferences(downloadCount)}
        </button>
        <button type="submit" formAction={docxAction} formMethod="get" disabled={!canDownload}>
          {PDF.downloadReferencesDocx(downloadCount)}
        </button>
        <button type="submit" formAction={epubAction} formMethod="get" disabled={!canDownload}>
          {PDF.downloadReferencesEpub(downloadCount)}
        </button>
        <button type="submit" formAction={markdownAction} formMethod="get" disabled={!canDownload}>
          {PDF.downloadReferencesMarkdown(downloadCount)}
        </button>
        <button type="submit" formAction={wikiAction} formMethod="get" disabled={!canDownload}>
          {PDF.downloadReferencesWiki(downloadCount)}
        </button>
        {!canDownload ? (
          <span className="small muted" role="status">
            {submitSelectionOverride && selected.size === 0 ? PDF.nothingSelectedOverride : PDF.nothingSelected}
          </span>
        ) : null}
      </div>
    </form>
  );
}
