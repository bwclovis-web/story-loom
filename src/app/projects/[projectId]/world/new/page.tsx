import { ReferenceCreateForm } from "@/components/world/ReferenceCreateForm";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { getDb } from "@/server/db";
import { listAvailableWorldCategories } from "@/server/services/worldCategoryService";
import { listAvailableWorldKindTemplates } from "@/server/services/worldKindTemplateService";
import { getSpellingLanguage } from "@/server/spelling";
import { REFERENCE_FORM } from "@/ui/labels";
import { isWorldType } from "@/ui/world";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";
import { defaultRecordTypeForCategory } from "@/world/hubDiscovery";
import { listAvailableWorldProfileDefinitions } from "@/world/worldProfileRegistry";

export const dynamic = "force-dynamic";

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export default async function NewReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ type?: string; category?: string; subcategory?: string; tag?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const spellingLanguage = await getSpellingLanguage();
  const category = clean(query.category);
  const subcategory = category ? clean(query.subcategory) : null;
  const tag = clean(query.tag);
  const db = getDb();
  const [availableCategories, availableTemplates] = await Promise.all([
    listAvailableWorldCategories(db, projectId),
    listAvailableWorldKindTemplates(db, projectId),
  ]);
  const customCategories: CustomTaxonomyCategoryOption[] = availableCategories.map((row) => ({
    slug: row.slug,
    label: row.label,
    description: row.description,
    parentCategorySlug: row.parentCategorySlug,
    shared: Boolean(row.home),
    homeLabel: row.home ? row.home.bookName?.trim() || row.home.title : null,
  }));
  const profileDefinitions = listAvailableWorldProfileDefinitions(availableTemplates)
    .slice()
    .sort((a, b) => {
      const aMatch = category && a.categorySlug === category ? 0 : a.id.startsWith("category:") ? 1 : 2;
      const bMatch = category && b.categorySlug === category ? 0 : b.id.startsWith("category:") ? 1 : 2;
      return aMatch - bMatch || a.label.localeCompare(b.label);
    })
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
    }));
  const defaultType = isWorldType(query.type) ? query.type : defaultRecordTypeForCategory(category);
  const crumbs = worldSurfaceCrumbs(projectId, "references", REFERENCE_FORM.newTitle);

  return (
    <div className="reference-create">
      <ProjectPageHeader
        projectId={projectId}
        title={REFERENCE_FORM.newTitle}
        crumbs={crumbs}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
        actions={<p className="reference-create-step">{REFERENCE_FORM.createStep}</p>}
      />
      <ReferenceCreateForm
        projectId={projectId}
        spellingLanguage={spellingLanguage}
        defaultType={defaultType}
        defaultCategory={category}
        defaultSubcategory={subcategory}
        defaultTag={tag}
        customCategories={customCategories}
        profileDefinitions={profileDefinitions}
      />
    </div>
  );
}
