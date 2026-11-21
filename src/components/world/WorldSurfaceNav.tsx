import { WORLD } from "@/ui/labels";
import { ButtonLink } from "@/components/ui/Button";
import { worldHref } from "@/ui/world";

/** References, Maps, Boards, and the story timeline. */
export function WorldSurfaceNav({
  projectId,
  current,
}: {
  projectId: string;
  current: "references" | "maps" | "boards" | "events" | "relationships" | "calendar" | "names";
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const items = [
    { key: "references" as const, href: worldHref(projectId), title: WORLD.references, hint: WORLD.referencesHint },
    { key: "maps" as const, href: `${base}/world/maps`, title: WORLD.maps, hint: WORLD.mapsNavHint },
    { key: "boards" as const, href: `${base}/world/boards`, title: WORLD.boards, hint: WORLD.boardsNavHint },
    { key: "events" as const, href: `${base}/world/events`, title: WORLD.storyTimeline, hint: WORLD.storyTimelineHint },
    { key: "calendar" as const, href: `${base}/world/calendar`, title: WORLD.worldCalendar, hint: WORLD.worldCalendarHint },
    {
      key: "relationships" as const,
      href: `${base}/world/relationships`,
      title: WORLD.relationships,
      hint: WORLD.relationshipsNavHint,
    },
    {
      key: "names" as const,
      href: `${base}/world/names`,
      title: WORLD.nameGenerator,
      hint: WORLD.nameGeneratorNavHint,
    },
  ];

  return (
    <nav className="panel workspace-tools" aria-label={WORLD.worldSurfaces}>
      <ul className="workspace-tools-list">
        {items.map((item) => (
          <li key={item.key} className={current === item.key ? "workspace-tool emphasized" : "workspace-tool"}>
            <div>
              <strong>{item.title}</strong>
              <p className="small muted" style={{ margin: "0.25rem 0 0" }}>
                {item.hint}
              </p>
            </div>
            <ButtonLink variant="secondary" href={item.href} aria-current={current === item.key ? "page" : undefined}>
              {WORLD.openSurface}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
