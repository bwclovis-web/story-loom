import Link from "next/link";
import { getDb } from "@/server/db";
import { listWeaveGrids, WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS } from "@/server/services/weaveService";
import { WorkspaceToolsChooser } from "@/components/shell/WorkspaceToolsChooser";
import { GROUP_PAGES, WEAVE, WORKSPACE_TOOLS } from "@/ui/labels";
import { RECORD_GROUPS } from "@/ui/navigation";
import { RecordListPage } from "../RecordListPage";
import { CreateWeaveGridForm } from "./weave/CreateWeaveGridForm";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const grids = await listWeaveGrids(getDb(), projectId).catch(() => []);
  const base = `/projects/${encodeURIComponent(projectId)}/plan`;

  return (
    <>
      <section className="panel" aria-labelledby="weave-heading" style={{ marginBottom: "1.5rem" }}>
        <header className="page-header" style={{ marginBottom: "0.5rem" }}>
          <h1 id="weave-heading">{WEAVE.heading}</h1>
        </header>
        <p className="page-lead">{WEAVE.lead}</p>
        <WorkspaceToolsChooser projectId={projectId} emphasize="weave" />
        <p className="row" style={{ gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <Link className="button-link" href={`${base}/weave`}>
            {WORKSPACE_TOOLS.openWeave}
          </Link>
          <Link className="button-link secondary" href={`${base}/weave/templates`}>
            {WEAVE.templates}
          </Link>
        </p>
        <CreateWeaveGridForm projectId={projectId} />
        {grids.length === 0 ? (
          <p className="muted" style={{ marginTop: "1rem" }}>
            {WEAVE.noGrids}
          </p>
        ) : (
          <ul className="stack" style={{ marginTop: "1rem" }}>
            {WEAVE_VIEW_KINDS.map((kind) => {
              const ofKind = grids.filter((g) => g.viewKind === kind);
              if (!ofKind.length) return null;
              return (
                <li key={kind}>
                  <h2 className="small">{WEAVE_VIEW_LABELS[kind]}</h2>
                  <ul className="stack">
                    {ofKind.map((g) => (
                      <li key={g.id} className="row" style={{ justifyContent: "space-between", gap: "1rem" }}>
                        <div>
                          <Link href={`${base}/weave/${encodeURIComponent(g.id)}`}>{g.title}</Link>{" "}
                          <span className="small muted">{WEAVE.beatsCount(g.beatCount)}</span>
                        </div>
                        <Link className="small-button secondary" href={`${base}/weave/${encodeURIComponent(g.id)}`}>
                          {WEAVE.openGrid}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RecordListPage
        projectId={projectId}
        heading={WEAVE.outlinesHeading}
        lead={GROUP_PAGES.plan}
        types={RECORD_GROUPS.plan}
        defaultType="chapter_outline"
      />
    </>
  );
}
