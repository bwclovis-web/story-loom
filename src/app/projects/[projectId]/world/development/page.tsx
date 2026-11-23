import Link from "next/link";
import { CharacterAnalysisWorkspace } from "@/components/world/CharacterDevelopment";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { forgottenArcs } from "@/domain/characterDevelopment";
import { getAssistantConfig } from "@/server/assistantConfig";
import { getDb } from "@/server/db";
import { loadDevelopmentEvidenceCatalog, loadSeriesDevelopment } from "@/server/services/characterDevelopmentService";
import { CHARACTER_ANALYSIS, CHARACTER_DEVELOPMENT, CHARACTER_DOSSIER_UPGRADE } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";

export const dynamic = "force-dynamic";

export default async function CharacterDevelopmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ character?: string; importance?: string; unresolved?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const db = getDb();
  const [overview, evidence] = await Promise.all([loadSeriesDevelopment(db, projectId), loadDevelopmentEvidenceCatalog(db, projectId)]);
  const assistantConfigured = getAssistantConfig().status.configured;
  const importance = query.importance ?? "";
  const character = query.character ?? "";
  const unresolvedOnly = query.unresolved === "1";
  const rows = overview.rows.filter((row) => {
    if (character && row.characterId !== character) return false;
    if (importance && row.importance !== importance && !row.books.some((book) => book.importance === importance)) return false;
    if (unresolvedOnly && row.unresolved.length === 0) return false;
    return true;
  });
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "development")}
        title={CHARACTER_DEVELOPMENT.seriesHeading}
        lead={overview.standalone ? `${CHARACTER_DEVELOPMENT.seriesLead}` : CHARACTER_DEVELOPMENT.seriesLead}
      />
      <p className="small">
        <Link href={`${base}/world/development/upgrade`}>{CHARACTER_DOSSIER_UPGRADE.seriesHeading}</Link>
        {" — "}
        {CHARACTER_DOSSIER_UPGRADE.openUpgradeHint}
      </p>
      <form className="row" method="get" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <label>
          {CHARACTER_DEVELOPMENT.filterCharacter}
          <select name="character" defaultValue={character}>
            <option value="">{CHARACTER_DEVELOPMENT.all}</option>
            {overview.characters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {CHARACTER_DEVELOPMENT.filterImportance}
          <select name="importance" defaultValue={importance}>
            <option value="">{CHARACTER_DEVELOPMENT.all}</option>
            <option value="protagonist">{CHARACTER_DEVELOPMENT.importanceLevels.protagonist}</option>
            <option value="major">{CHARACTER_DEVELOPMENT.importanceLevels.major}</option>
            <option value="supporting">{CHARACTER_DEVELOPMENT.importanceLevels.supporting}</option>
            <option value="minor">{CHARACTER_DEVELOPMENT.importanceLevels.minor}</option>
            <option value="background">{CHARACTER_DEVELOPMENT.importanceLevels.background}</option>
          </select>
        </label>
        <Checkbox className="small" name="unresolved" value="1" defaultChecked={unresolvedOnly} label={CHARACTER_DEVELOPMENT.unresolved} />
        <Button type="submit">{CHARACTER_DEVELOPMENT.showMatches}</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState>{CHARACTER_DEVELOPMENT.noCharacters}</EmptyState>
      ) : (
        <div className="stack">
          <h2>{CHARACTER_DEVELOPMENT.matrix}</h2>
          <DataTable
            label={CHARACTER_DEVELOPMENT.matrix}
            columns={
              [
                { id: "character", header: "Character" },
                ...overview.books.map((book) => ({ id: book.id, header: book.label })),
              ] satisfies DataTableColumn[]
            }
            rows={rows.map((row): DataTableRow => ({
              id: row.characterId,
              cells: [
                <div key="character">
                  <Link href={`${base}/records/${encodeURIComponent(row.characterId)}#character-development`}>{row.title}</Link>
                  <div className="small muted">{row.importance ?? "unset"}</div>
                  {row.seriesPlanSummary ? <div className="small muted">{row.seriesPlanSummary}</div> : null}
                </div>,
                ...row.books.map((book) => (
                  <div key={book.projectId}>
                    <div className="small">{book.presence ?? "—"}</div>
                    <div className="small muted">{book.importance ?? ""}</div>
                    {book.arcTemplate ? <div className="small muted">{book.arcTemplate.replaceAll("_", " ")}</div> : null}
                    {book.arcTitles.map((title) => (
                      <div key={title} className="small">
                        {title}
                      </div>
                    ))}
                  </div>
                )),
              ],
            }))}
          />
          <h2>{CHARACTER_DEVELOPMENT.unresolved}</h2>
          <ul>
            {overview.characters.flatMap((item) =>
              forgottenArcs(item.profile).map((arc) => (
                <li key={`${item.id}:${arc.id}`}>
                  <Link href={`${base}/records/${encodeURIComponent(item.id)}#character-development`}>
                    {item.title}: {arc.title}
                  </Link>
                </li>
              )),
            )}
          </ul>
          <h2>{CHARACTER_ANALYSIS.heading}</h2>
          <CharacterAnalysisWorkspace
            projectId={projectId}
            characterIds={overview.characters.slice(0, 3).map((item) => item.id)}
            characters={overview.characters.map((item) => ({ id: item.id, label: item.title }))}
            chapters={evidence.chapters.map((row) => ({ id: row.id, label: row.label }))}
            scenes={evidence.scenes.map((row) => ({ id: row.id, label: row.label }))}
            books={overview.books}
            assistantConfigured={assistantConfigured}
          />
        </div>
      )}
    </>
  );
}
