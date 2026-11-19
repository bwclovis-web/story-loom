import Link from "next/link";
import { CONTINUE_WRITING, NAV } from "@/ui/labels";

export interface ContinueWritingItem {
  id: string;
  title: string;
  kind: "chapter" | "scene";
  parentTitle?: string;
}

/** Primary entry to keep writing an existing manuscript page. */
export function ContinueWriting({
  projectId,
  items,
}: {
  projectId: string;
  items: ContinueWritingItem[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <section className="panel continue-writing" aria-labelledby="continue-writing-heading">
      <h2 id="continue-writing-heading">{CONTINUE_WRITING.heading}</h2>
      <p className="small muted">{CONTINUE_WRITING.lead}</p>
      {items.length === 0 ? (
        <div className="stack">
          <p className="muted">{CONTINUE_WRITING.empty}</p>
          <p className="small muted">{CONTINUE_WRITING.emptyHint}</p>
          <Link className="button-link" href={`${base}/import-chapters`}>
            {CONTINUE_WRITING.importChapters}
          </Link>
        </div>
      ) : (
        <ul className="continue-writing-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                {item.parentTitle ? (
                  <span className="small muted"> · {item.parentTitle}</span>
                ) : (
                  <span className="small muted"> · {item.kind === "chapter" ? "Chapter" : "Scene"}</span>
                )}
              </div>
              <Link className="button-link" href={`${base}/records/${encodeURIComponent(item.id)}`}>
                {CONTINUE_WRITING.open(item.title)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        <Link href={`${base}/read`}>{NAV.readBook}</Link>
      </p>
    </section>
  );
}
