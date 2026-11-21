import Link from "next/link";
import { HelpHint } from "@/components/HelpHint";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listBoards } from "@/server/services/boardService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { CreateBoardForm } from "./CreateBoardForm";

export const dynamic = "force-dynamic";

export default async function WorldBoardsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const boards = await listBoards(getDb(), projectId).catch(() => []);
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "boards")}
        title={WORLD.boards}
        help={
          <HelpHint anchor="world-boards" topic="World boards">
            Boards are optional. Removing a card only removes it from that board. Ask about this board previews linked
            records before opening the assistant.
          </HelpHint>
        }
      />

      <section className="panel stack" aria-labelledby="create-board-heading">
        <h2 id="create-board-heading">{WORLD.newBoard}</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Place dossiers and places you already have. Positions stay on this board only.
        </p>
        <CreateBoardForm projectId={projectId} />
      </section>

      <section className="panel" aria-labelledby="boards-list-heading">
        <h2 id="boards-list-heading">{WORLD.boards}</h2>
        {boards.length === 0 ? (
          <EmptyState>{WORLD.noBoards}</EmptyState>
        ) : (
          <ul className="nav-list">
            {boards.map((b) => (
              <li key={b.id} className="row" style={{ justifyContent: "space-between", gap: "0.75rem" }}>
                <span>
                  <Link href={`${base}/world/boards/${encodeURIComponent(b.id)}`}>{b.title}</Link>{" "}
                  <span className="small muted">
                    {b.templateKey === "geography" ? WORLD.templateGeography : WORLD.templateBlank} ·{" "}
                    {WORLD.cardsCount(b.cardCount)}
                  </span>
                </span>
                <ButtonLink href={`${base}/world/boards/${encodeURIComponent(b.id)}`} variant="secondary" size="sm">
                  {WORLD.openBoard}
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
