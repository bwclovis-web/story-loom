import Link from "next/link";
import { sha256 } from "@/domain/json";
import { milestoneFreshness } from "@/domain/characterDevelopment";
import { readDossierMarkdownArchiveWithStatus } from "@/domain/characterDossierUpgrade";
import { CharacterDevelopmentPanel } from "@/components/world/CharacterDevelopment";
import { getAssistantConfig } from "@/server/assistantConfig";
import { getDb } from "@/server/db";
import { loadCharacterDevelopment, loadSeriesDevelopment, visibleTraits } from "@/server/services/characterDevelopmentService";
import { CHARACTER_DEVELOPMENT } from "@/ui/labels";
import { seriesRecordHref } from "@/world/seriesHome";

/**
 * Optional development on an existing character dossier. Series copies are
 * edited in the book that owns the record.
 */
export async function CharacterDevelopmentSection({ projectId, recordId }: { projectId: string; recordId: string }) {
  const db = getDb();
  const loaded = await loadCharacterDevelopment(db, projectId, recordId);
  if (loaded.record.type !== "character_dossier") return null;
  if (loaded.record.projectId !== projectId) {
    return (
      <section className="panel" id="character-development">
        <h2>{CHARACTER_DEVELOPMENT.heading}</h2>
        <p className="small">{CHARACTER_DEVELOPMENT.homeElsewhere}</p>
        <p>
          <Link href={`${seriesRecordHref(loaded.record.projectId, loaded.record.id)}#character-development`}>
            {CHARACTER_DEVELOPMENT.openDossier}
          </Link>
        </p>
      </section>
    );
  }

  const [overview, relations, events, manuscript, beats, facts, worldRefs] = await Promise.all([
    loadSeriesDevelopment(db, projectId),
    db.recordRelation.findMany({
      where: { projectId, OR: [{ fromRecordId: recordId }, { toRecordId: recordId }] },
      select: { id: true, kind: true, customLabel: true },
    }),
    db.storyEvent.findMany({ where: { projectId }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
      select: { id: true, title: true, type: true, currentRevision: true, body: true },
    }),
    db.weaveBeat.findMany({ where: { projectId }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 200 }),
    db.establishedFact.findMany({
      where: { projectId, subjectRecordId: recordId },
      select: { id: true, statement: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.record.findMany({
      where: {
        projectId,
        trashedAt: null,
        type: { in: ["worldbuilding", "rules_glossary", "reference_note"] },
      },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
      take: 200,
    }),
  ]);

  const fieldAge = typeof loaded.record.fields.age === "string" || typeof loaded.record.fields.age === "number"
    ? String(loaded.record.fields.age)
    : "";

  const revisions = new Map(manuscript.map((row) => [row.id, { revision: row.currentRevision, hash: sha256(row.body) }]));
  const staleMilestoneIds = loaded.profile.arcs.flatMap((arc) =>
    arc.milestones.flatMap((milestone) => {
      const sourceId = milestone.sceneRecordId || milestone.chapterRecordId;
      if (!sourceId) return [];
      const current = revisions.get(sourceId) ?? null;
      return milestoneFreshness(milestone, current) === "stale" ? [milestone.id] : [];
    }),
  );

  const assistant = getAssistantConfig().status;
  const archiveRead = readDossierMarkdownArchiveWithStatus(loaded.record.fields);
  return (
    <section className="panel" id="character-development" aria-label={CHARACTER_DEVELOPMENT.heading}>
      <h2>{CHARACTER_DEVELOPMENT.heading}</h2>
      <CharacterDevelopmentPanel
        projectId={projectId}
        recordId={recordId}
        title={loaded.record.title}
        body={loaded.record.body}
        revision={loaded.record.currentRevision}
        isProtected={loaded.record.protected}
        initialProfile={loaded.profile}
        fieldAge={fieldAge}
        traits={visibleTraits(loaded.profile, loaded.foundation?.profile ?? null)}
        staleMilestoneIds={staleMilestoneIds}
        archive={archiveRead.archive}
        archiveProblems={archiveRead.problems.map((problem) => problem.message)}
        catalog={{
          books: overview.books,
          characters: overview.characters
            .filter((character) => character.id !== recordId)
            .map((character) => ({ id: character.id, label: character.title })),
          relations: relations.map((relation) => ({
            id: relation.id,
            label: relation.customLabel || relation.kind.replaceAll("_", " "),
          })),
          events: events.map((event) => ({ id: event.id, label: event.title })),
          chapters: manuscript.filter((row) => row.type === "manuscript_chapter").map((row) => ({ id: row.id, label: row.title })),
          scenes: manuscript.filter((row) => row.type === "manuscript_scene").map((row) => ({ id: row.id, label: row.title })),
          beats: beats.map((beat) => ({ id: beat.id, label: beat.title })),
          facts: facts.map((fact) => ({ id: fact.id, label: fact.statement.slice(0, 80) })),
          worldRefs: worldRefs.map((ref) => ({ id: ref.id, label: ref.title })),
          assistantConfigured: assistant.configured,
        }}
      />
    </section>
  );
}
