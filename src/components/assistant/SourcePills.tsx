import Link from "next/link";
import { retrievalSourceHref, retrievalSourceLabel } from "@/assistant/sourceHref";
import type { RetrievalSourceNote } from "@/assistant/retrievalMeta";
import { ExtLinkIcon } from "@/components/shell/icons";
import type { ContextItemView } from "@/server/services/assistantService";

export function contextItemLabel(c: ContextItemView): string {
  if (c.kind === "passage") return `${c.title} · passage`;
  if (c.kind === "section") return `${c.title} · section`;
  if (c.kind === "manuscript") return `${c.title} · chapter`;
  return `${c.title} · rev ${c.revisionNumber}`;
}

export function extraRetrievalSources(
  items: readonly { recordId: string }[],
  sources: readonly RetrievalSourceNote[] | undefined,
): RetrievalSourceNote[] {
  const seen = new Set(items.map((item) => item.recordId));
  return (sources ?? []).filter((source) => {
    if (source.origin !== "tool") return false;
    if (source.eventId || source.mapId || source.stale || source.passageStart != null) return true;
    return Boolean(source.recordId) && !seen.has(source.recordId);
  });
}

export function SourcePills({
  projectId,
  items,
  sources,
  limit = 3,
}: {
  projectId: string;
  items: readonly ContextItemView[];
  sources?: readonly RetrievalSourceNote[];
  limit?: number;
}) {
  const extras = extraRetrievalSources(items, sources);
  const pills = [
    ...items.map((item) => ({ key: item.recordId, href: `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(item.recordId)}`, label: `${contextItemLabel(item)}${item.olderVersion ? ` · now rev ${item.currentRevision}` : ""}` })),
    ...extras.map((source, index) => ({
      key: `${source.eventId ?? source.mapId ?? source.recordId}-${index}`,
      href: retrievalSourceHref(projectId, source),
      label: retrievalSourceLabel(source),
    })),
  ].slice(0, limit);
  if (!pills.length) return null;
  return (
    <ul className="source-pills">
      {pills.map((pill) => (
        <li key={pill.key}>
          {pill.href ? (
            <Link className="source-pill" href={pill.href}>
              <span>{pill.label}</span>
              <ExtLinkIcon />
            </Link>
          ) : (
            <span className="source-pill">{pill.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
