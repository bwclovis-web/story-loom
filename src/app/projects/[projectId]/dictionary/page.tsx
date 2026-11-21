import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { listDictionary } from "@/server/services/dictionaryService";
import { findProject } from "@/server/services/projectService";
import { getSpellingLanguage } from "@/server/spelling";
import { DICTIONARY } from "@/ui/labels";
import { DictionaryManager } from "./DictionaryManager";

export const dynamic = "force-dynamic";

export default async function DictionaryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const [entries, language] = await Promise.all([listDictionary(db, projectId), getSpellingLanguage()]);

  return (
    <>
      <ProjectPageHeader projectId={projectId} title={DICTIONARY.heading} />
      <p className="muted small">{DICTIONARY.intro}</p>
      <HelpHint anchor="dictionary" topic="the dictionary">
        Project words apply to this book only. Workspace words apply to every project in {project.workspace.name}.
      </HelpHint>
      <DictionaryManager
        projectId={projectId}
        projectTitle={project.title}
        workspaceName={project.workspace.name}
        language={language}
        project={entries.project}
        workspace={entries.workspace}
      />
    </>
  );
}
