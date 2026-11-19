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

/** World references table row (labelled badges; optional type column). */
export function WorldRecordTableRow({
  projectId,
  recordId,
  title,
  typeLabel,
  authorityStatus,
  currentRevision,
  isProtected,
}: {
  projectId: string;
  recordId: string;
  title: string;
  typeLabel?: string;
  authorityStatus: AuthorityStatus;
  currentRevision: number;
  isProtected: boolean;
}) {
  return (
    <tr>
      <td>
        <Link href={recordHref(projectId, recordId)}>{title}</Link>
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
