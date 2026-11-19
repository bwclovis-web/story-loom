import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { OverflowDisclosure } from "@/components/shell/OverflowDisclosure";
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
  const primaryGrid = grids[0] ?? null;

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

      {primaryGrid ? (
        <p className="row" style={{ flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
          <ButtonLink href={`${base}/plan/weave/${encodeURIComponent(primaryGrid.id)}`}>
            {WEAVE.openGrid}: {primaryGrid.title}
          </ButtonLink>
        </p>
      ) : null}

      <OverflowDisclosure summary={WEAVE.newGrid} className="panel" defaultOpen={!grids.length}>
        <CreateWeaveGridForm projectId={projectId} />
        <p className="row" style={{ marginTop: "0.75rem", gap: "1rem", flexWrap: "wrap" }}>
          <Link href={`${base}/plan/weave/build`}>{WEAVE.buildFromDraft}</Link>
          <Link href={`${base}/plan/weave/templates`}>{WEAVE.templates}</Link>
          {templates.length ? <span className="small muted"> ({templates.length})</span> : null}
        </p>
      </OverflowDisclosure>

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
                    <Link className="small-button" href={`${base}/plan/weave/${encodeURIComponent(g.id)}`}>
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
