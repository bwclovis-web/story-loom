import { WORKSPACE_TOOLS } from "@/ui/labels";
import { ButtonLink } from "@/components/ui/Atoms/Button";

/** Concise chooser so authors can tell map / board / plot grid apart without Help. */
export function WorkspaceToolsChooser({
  projectId,
  emphasize,
}: {
  projectId: string;
  emphasize?: "weave" | "board" | "map";
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const items = [
    {
      key: "weave" as const,
      href: `${base}/plan/weave`,
      title: WORKSPACE_TOOLS.weave,
      hint: WORKSPACE_TOOLS.weaveHint,
      cta: WORKSPACE_TOOLS.openWeave,
    },
    {
      key: "board" as const,
      href: `${base}/world/boards`,
      title: WORKSPACE_TOOLS.board,
      hint: WORKSPACE_TOOLS.boardHint,
      cta: WORKSPACE_TOOLS.openBoard,
    },
    {
      key: "map" as const,
      href: `${base}/world/maps`,
      title: WORKSPACE_TOOLS.map,
      hint: WORKSPACE_TOOLS.mapHint,
      cta: WORKSPACE_TOOLS.openMap,
    },
  ];

  return (
    <section className="panel workspace-tools" aria-labelledby="workspace-tools-heading">
      <h2 id="workspace-tools-heading">{WORKSPACE_TOOLS.heading}</h2>
      <p className="small muted">{WORKSPACE_TOOLS.lead}</p>
      <ul className="workspace-tools-list">
        {items.map((item) => (
          <li key={item.key} className={emphasize === item.key ? "workspace-tool emphasized" : "workspace-tool"}>
            <div>
              <strong>{item.title}</strong>
              <p className="small muted" style={{ margin: "0.25rem 0 0.5rem" }}>
                {item.hint}
              </p>
            </div>
            <ButtonLink variant={emphasize === item.key ? "primary" : "secondary"} href={item.href}>
              {item.cta}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
