import Link from "next/link";
import { WorldDestinationIcon } from "@/components/world/WorldDestinationIcon";
import { WORLD } from "@/ui/labels";
import {
  worldDestinationHref,
  WORLD_DESTINATION_GROUPS,
  worldDestinationsInGroup,
  type WorldDestinationKey,
} from "@/ui/worldDestinations";

/** Compact discovery list for the References hub. Uses the shared destination registry. */
export function WorldDirectory({
  projectId,
  current = "references",
  rail = false,
}: {
  projectId: string;
  current?: WorldDestinationKey;
  /** Right-hand column on the References hub. */
  rail?: boolean;
}) {
  return (
    <section className={rail ? "world-directory world-directory-rail" : "world-directory"} aria-labelledby="world-directory-heading">
      <h2 id="world-directory-heading">{WORLD.worldDirectory}</h2>
      <div className="world-directory-groups">
        {WORLD_DESTINATION_GROUPS.map((group) => (
          <div key={group.id} className="world-directory-group">
            <h3>{group.heading}</h3>
            <ul>
              {worldDestinationsInGroup(group).map((destination) => (
                <li key={destination.key}>
                  <Link
                    href={worldDestinationHref(projectId, destination.key)}
                    aria-current={destination.key === current ? "page" : undefined}
                  >
                    <WorldDestinationIcon destination={destination.key} />
                    {destination.label}
                  </Link>
                  <p className="small muted">{destination.hint}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
