import { ReferenceCreateForm } from "@/components/world/ReferenceCreateForm";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { getSpellingLanguage } from "@/server/spelling";
import { REFERENCE_FORM } from "@/ui/labels";
import { isWorldType } from "@/ui/world";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";

export const dynamic = "force-dynamic";

export default async function NewReferencePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const spellingLanguage = await getSpellingLanguage();
  const requested = isWorldType(query.type) ? query.type : "character_dossier";
  const defaultType =
    requested === "rules_glossary" || requested === "research_note" || requested === "worldbuilding" || requested === "character_dossier"
      ? requested
      : "character_dossier";
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
      <ReferenceCreateForm projectId={projectId} spellingLanguage={spellingLanguage} defaultType={defaultType} />
    </div>
  );
}
