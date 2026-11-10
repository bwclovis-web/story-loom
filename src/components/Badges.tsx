import type { ContentClass } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { WORLD, XREF } from "@/ui/labels";

export function StatusBadge({ status }: { status: AuthorityStatus | string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export function ProtectionBadge({ isProtected }: { isProtected: boolean }) {
  return isProtected ? <span className="badge protected">protected</span> : null;
}

export function ContentClassBadge({ contentClass }: { contentClass: ContentClass }) {
  return contentClass === "manuscript" ? <span className="badge manuscript">manuscript</span> : null;
}

export function RevisionBadge({ revision }: { revision: number }) {
  return <span className="badge">rev {revision}</span>;
}

/** Status with its meaning spelled out: only "approved" is canon. */
export function CanonBadge({ status }: { status: AuthorityStatus }) {
  return (
    <span className={`badge labelled ${status}`}>
      <span className="badge-label">{WORLD.canonStatus}:</span> {status}
      {status === "approved" ? null : <span className="badge-note"> (not canon)</span>}
    </span>
  );
}

/** A section's status tag, word for word from its heading. Never the record's canon status. */
export function SectionTagBadge({ tag }: { tag: string }) {
  return (
    <span className="badge section-tag" title={XREF.sectionTag}>
      {tag}
    </span>
  );
}

export function SavedVersionBadge({ revision }: { revision: number }) {
  return (
    <span className="badge labelled version">
      <span className="badge-label">{WORLD.savedVersion}:</span> {WORLD.revision(revision)}
    </span>
  );
}

/** Always shown, so an unprotected record says so too. */
export function ProtectionStateBadge({ isProtected }: { isProtected: boolean }) {
  return (
    <span className={`badge labelled ${isProtected ? "protected" : "unprotected"}`}>
      <span className="badge-label">{WORLD.protection}:</span> {isProtected ? WORLD.protectedLabel : WORLD.notProtected}
    </span>
  );
}
