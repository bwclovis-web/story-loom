import Link from "next/link";
import { getDb } from "@/server/db";
import { listWeaveGrids, listWeaveTemplates, WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS } from "@/server/services/weaveService";
import { SHELL, WEAVE } from "@/ui/labels";
import { CreateWeaveGridForm } from "./CreateWeaveGridForm";

export const dynamic = "force-dynamic";

export default async function WeaveIndexPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const [grids, templates] = await Promise.all([
    listWeaveGrids(db, projectId).catch(() => []),
    listWeaveTemplates(db, projectId).catch(() => []),
  ]);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumbs">
        <ol>
          <li>
            <Link href={`${base}/plan`}>{SHELL.plan}</Link>
          </li>
          <li>
            <span aria-current="page">{WEAVE.heading}</span>
          </li>
        </ol>
      </nav>
      <header className="page-header">
        <h1>{WEAVE.heading}</h1>
      </header>
      <p className="page-lead">{WEAVE.lead}</p>
      <p>
        <Link href={`${base}/plan/weave/templates`}>{WEAVE.templates}</Link>
        {templates.length ? <span className="small muted"> ({templates.length})</span> : null}
      </p>

      <section className="panel" aria-labelledby="new-weave-heading">
        <h2 id="new-weave-heading">{WEAVE.newGrid}</h2>
        <CreateWeaveGridForm projectId={projectId} />
      </section>

      {WEAVE_VIEW_KINDS.map((kind) => {
        const ofKind = grids.filter((g) => g.viewKind === kind);
        return (
          <section key={kind} className="panel" aria-labelledby={`weave-${kind}`}>
            <h2 id={`weave-${kind}`}>{WEAVE_VIEW_LABELS[kind]}</h2>
            {ofKind.length === 0 ? (
              <p className="muted">{WEAVE.noGrids}</p>
            ) : (
              <ul className="stack">
                {ofKind.map((g) => (
                  <li key={g.id} className="row" style={{ justifyContent: "space-between", gap: "1rem" }}>
                    <div>
                      <Link href={`${base}/plan/weave/${encodeURIComponent(g.id)}`}>{g.title}</Link>{" "}
                      <span className="small muted">{WEAVE.beatsCount(g.beatCount)}</span>
                    </div>
                    <Link className="small-button secondary" href={`${base}/plan/weave/${encodeURIComponent(g.id)}`}>
                      {WEAVE.openGrid}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
