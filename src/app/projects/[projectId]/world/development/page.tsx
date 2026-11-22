import Link from "next/link";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { forgottenArcs } from "@/domain/characterDevelopment";
import { getDb } from "@/server/db";
import { loadSeriesDevelopment } from "@/server/services/characterDevelopmentService";
import { CHARACTER_DEVELOPMENT } from "@/ui/labels";
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
  const overview = await loadSeriesDevelopment(getDb(), projectId);
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
            <option value="major">major</option>
            <option value="supporting">supporting</option>
            <option value="recurring">recurring</option>
            <option value="minor">minor</option>
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
          <table>
            <thead>
              <tr>
                <th>Character</th>
                {overview.books.map((book) => (
                  <th key={book.id}>{book.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.characterId}>
                  <td>
                    <Link href={`${base}/records/${encodeURIComponent(row.characterId)}#character-development`}>{row.title}</Link>
                    <div className="small muted">{row.importance ?? "unset"}</div>
                  </td>
                  {row.books.map((book) => (
                    <td key={book.projectId}>
                      <div className="small">{book.presence ?? "—"}</div>
                      <div className="small muted">{book.importance ?? ""}</div>
                      {book.arcTitles.map((title) => (
                        <div key={title} className="small">
                          {title}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
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
        </div>
      )}
    </>
  );
}
