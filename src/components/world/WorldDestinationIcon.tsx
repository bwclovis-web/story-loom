import {
  BookOpen,
  Calendar,
  CalendarDays,
  FileText,
  Languages,
  LayoutGrid,
  Map,
  MapPin,
  Scale,
  ScrollText,
  Sparkles,
  ListChecks,
  User,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { WorldDestinationKey } from "@/ui/worldDestinations";

const DESTINATION_ICONS: Record<WorldDestinationKey, LucideIcon> = {
  references: BookOpen,
  relationships: Waypoints,
  maps: Map,
  boards: LayoutGrid,
  events: CalendarDays,
  calendar: Calendar,
  names: Sparkles,
  continuity: ListChecks,
};

/** Icon for a World surface. Decorative; the link text is the name. */
export function WorldDestinationIcon({ destination }: { destination: WorldDestinationKey }) {
  const Icon = DESTINATION_ICONS[destination];
  return <Icon className="world-destination-icon" strokeWidth={1.75} aria-hidden="true" />;
}

/** Icon for a reference card, from its document type and optional kind. */
export function WorldRecordIcon({ type, kind }: { type: string; kind: string | null }) {
  const Icon: LucideIcon =
    type === "character_dossier"
      ? User
      : type === "canon_decision"
        ? Scale
        : type === "continuity_note"
          ? ScrollText
          : type === "reference_note"
            ? FileText
            : kind === "place"
              ? MapPin
              : kind === "language"
                ? Languages
                : BookOpen;
  return <Icon className="world-record-icon" strokeWidth={1.75} aria-hidden="true" />;
}
