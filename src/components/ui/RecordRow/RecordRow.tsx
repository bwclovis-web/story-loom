import Link from "next/link";
import type { ReactNode } from "react";
import {
  CanonBadge,
  ContentClassBadge,
  ProtectionBadge,
  ProtectionStateBadge,
  RevisionBadge,
  SavedVersionBadge,
  StatusBadge,
} from "@/components/Badges";
import type { ContentClass } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { cn } from "@/ui/cn";
import { SERIES } from "@/ui/labels";
import { formatWordCount } from "@/writing/wordCount";

function recordHref(projectId: string, recordId: string) {
  return `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
}

/** Write / Plan / All Records table row (title, id, compact badges). */
export function RecordTableRow({
  projectId,
  recordId,
  title,
  authorityStatus,
  currentRevision,
  contentClass,
  isProtected,
  wordCount,
}: {
  projectId: string;
  recordId: string;
  title: string;
  authorityStatus: AuthorityStatus | string;
  currentRevision: number;
  contentClass: ContentClass;
  isProtected: boolean;
  wordCount?: number;
}) {
  return (
    <tr>
      <td style={{ width: "40%" }}>
        <Link href={recordHref(projectId, recordId)}>{title}</Link>
      </td>
      <td className="muted small">
        <code>{recordId}</code>
      </td>
      <td className="row">
        <StatusBadge status={authorityStatus} />
        <RevisionBadge revision={currentRevision} />
        <ContentClassBadge contentClass={contentClass} />
        <ProtectionBadge isProtected={isProtected} />
        {wordCount !== undefined ? <span className="small muted">{formatWordCount(wordCount)}</span> : null}
      </td>
    </tr>
  );
}

/** World references table row (labelled badges; optional type / taxonomy columns). */
export function WorldRecordTableRow({
  projectId,
  recordId,
  title,
  typeLabel,
  taxonomyLabel,
  secondaryLabels,
  scopeLabel,
  authorityStatus,
  currentRevision,
  isProtected,
  homeBook,
}: {
  projectId: string;
  recordId: string;
  title: string;
  typeLabel?: string;
  /** Primary category · subcategory (or inferred label). */
  taxonomyLabel?: string | null;
  secondaryLabels?: readonly string[];
  scopeLabel?: string | null;
  authorityStatus: AuthorityStatus;
  currentRevision: number;
  isProtected: boolean;
  /** Series reference opened from a sibling book. */
  homeBook?: { label: string; editHref: string } | null;
}) {
  return (
    <tr>
      <td>
        <Link href={recordHref(projectId, recordId)}>{title}</Link>
        {taxonomyLabel || (secondaryLabels && secondaryLabels.length) || scopeLabel ? (
          <p className="small muted world-row-taxonomy">
            {taxonomyLabel ? <span className="badge">{taxonomyLabel}</span> : null}
            {secondaryLabels?.map((label) => (
              <span key={label} className="badge badge-muted">
                + {label}
              </span>
            ))}
            {scopeLabel ? <span className="badge badge-muted">{scopeLabel}</span> : null}
          </p>
        ) : null}
        {homeBook ? (
          <p className="small">
            <span className="muted">{SERIES.homeBadge(homeBook.label)}</span>{" "}
            <Link href={homeBook.editHref}>{SERIES.editIn(homeBook.label)}</Link>
          </p>
        ) : null}
      </td>
      {typeLabel !== undefined ? <td className="small">{typeLabel}</td> : null}
      <td>
        <CanonBadge status={authorityStatus} />
      </td>
      <td>
        <SavedVersionBadge revision={currentRevision} />
      </td>
      <td>
        <ProtectionStateBadge isProtected={isProtected} />
      </td>
    </tr>
  );
}

/** Flex list row for continue-writing / book-order style layouts. */
export function RecordFlexRow({
  title,
  titleHref,
  meta,
  badges,
  actions,
  className,
  titleAs = "link",
}: {
  title: string;
  titleHref?: string;
  meta?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleAs?: "link" | "strong";
}) {
  const titleNode =
    titleAs === "strong" || !titleHref ? (
      <strong>{title}</strong>
    ) : (
      <Link href={titleHref} className="book-order-title">
        {title}
      </Link>
    );

  return (
    <div className={cn(className)}>
      {titleNode}
      {meta}
      {badges ? <span className="book-order-facts small">{badges}</span> : null}
      {actions ? <span className="book-order-actions">{actions}</span> : null}
    </div>
  );
}
