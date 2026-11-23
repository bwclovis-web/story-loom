import { WorldProfilePanel } from "@/components/world/WorldProfilePanel";
import { isWorldProfileRecordType, readWorldProfile } from "@/domain/worldProfile";
import type { JsonObject } from "@/domain/json";
import { getDb } from "@/server/db";
import { loadDevelopmentEvidenceCatalog } from "@/server/services/characterDevelopmentService";
import {
  listAvailableWorldKindTemplates,
  listWorldKindTemplates,
  resolveProfileDefinitionForRecord,
} from "@/server/services/worldKindTemplateService";
import {
  listAvailableWorldProfileDefinitions,
  listPlausibleWorldProfileDefinitions,
  listSubcategorySectionsForTaxonomy,
} from "@/world/worldProfileRegistry";
import { resolveRecordTaxonomy } from "@/world/taxonomy";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { PlaceRelationView } from "@/world/placeRelations";

export async function WorldProfileSection({
  projectId,
  recordId,
  recordType,
  revision,
  body,
  fields,
  editable,
  seriesHome,
  isProtected,
  homeProjectId,
  placeRelations = null,
  placeChoices = [],
}: {
  projectId: string;
  recordId: string;
  recordType: string;
  revision: number;
  body: string;
  fields: JsonObject;
  editable: boolean;
  seriesHome: SeriesHomeRef | null;
  isProtected: boolean;
  homeProjectId: string;
  placeRelations?: { outgoing: PlaceRelationView[]; incoming: PlaceRelationView[] } | null;
  placeChoices?: Array<{ id: string; title: string; typeLabel: string; homeLabel?: string | null }>;
}) {
  if (!isWorldProfileRecordType(recordType)) return null;
  const db = getDb();
  const [homeTemplates, availableTemplates, evidence] = await Promise.all([
    listWorldKindTemplates(db, homeProjectId),
    listAvailableWorldKindTemplates(db, projectId),
    loadDevelopmentEvidenceCatalog(db, projectId),
  ]);
  const historyCatalog = {
    books: evidence.books.map((book, index) => ({
      id: book.id,
      label: book.label,
      narrativeIndex: index,
    })),
    events: evidence.events,
    chapters: evidence.chapters.map(({ id, label, projectId: bookId }) => ({
      id,
      label,
      projectId: bookId,
    })),
    scenes: evidence.scenes.map(({ id, label, projectId: bookId }) => ({
      id,
      label,
      projectId: bookId,
    })),
    eventOrders: evidence.eventOrders.map((order) => ({
      earlierId: order.earlierEventId,
      laterId: order.laterEventId,
    })),
  };
  const read = readWorldProfile(fields);
  const taxonomy = resolveRecordTaxonomy({ type: recordType, fields });
  const categorySlugs = [
    ...(taxonomy.primary?.category ? [taxonomy.primary.category] : []),
    ...taxonomy.secondary.map((item) => item.category),
  ];
  const homeFirst = [
    ...homeTemplates.filter((template) => template.projectId === homeProjectId),
    ...availableTemplates.filter((template) => template.projectId !== homeProjectId),
  ];
  const definition = resolveProfileDefinitionForRecord({
    fields,
    recordProjectId: homeProjectId,
    homeTemplates,
    availableTemplates,
    definitionId: read.profile.definitionId,
    categorySlug: taxonomy.primary?.category ?? null,
    categorySlugs,
  });
  const plausible = listPlausibleWorldProfileDefinitions({
    fields,
    profile: read.profile,
    templates: homeFirst,
    recordProjectId: homeProjectId,
    categorySlugs,
  });
  const definitions = listAvailableWorldProfileDefinitions(availableTemplates);
  const suggestedSections = listSubcategorySectionsForTaxonomy({
    primary: taxonomy.primary,
    secondary: taxonomy.secondary,
  });

  return (
    <WorldProfilePanel
      projectId={projectId}
      recordId={recordId}
      revision={revision}
      body={body}
      profile={read.ok ? read.profile : null}
      definition={definition}
      definitions={definitions}
      plausibleDefinitions={plausible}
      suggestedSectionIds={suggestedSections.map((section) => section.id)}
      placeRelations={placeRelations}
      placeChoices={placeChoices}
      editable={editable}
      seriesHome={seriesHome}
      isProtected={isProtected}
      historyCatalog={historyCatalog}
    />
  );
}
