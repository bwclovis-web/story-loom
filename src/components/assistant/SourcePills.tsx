import Link from "next/link";
import { ExtLinkIcon } from "@/components/shell/icons";
import type { ContextItemView } from "@/server/services/assistantService";

export function contextItemLabel(c: ContextItemView): string {
  if (c.kind === "passage") return `${c.title} · passage`;
  if (c.kind === "section") return `${c.title} · section`;
  if (c.kind === "manuscript") return `${c.title} · chapter`;
  return `${c.title} · rev ${c.revisionNumber}`;
}

export function SourcePills({
  projectId,
  items,
  limit = 3,
}: {
  projectId: string;
  items: readonly ContextItemView[];
  limit?: number;
}) {
  const pills = items.slice(0, limit);
  if (!pills.length) return null;
  return (
    <ul className="source-pills">
      {pills.map((c, i) => (
        <li key={`${c.recordId}-${i}`}>
          <Link
            className="source-pill"
            href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(c.recordId)}`}
          >
            <span>
              {contextItemLabel(c)}
              {c.olderVersion ? ` · now rev ${c.currentRevision}` : ""}
            </span>
            <ExtLinkIcon />
          </Link>
        </li>
      ))}
    </ul>
  );
}
