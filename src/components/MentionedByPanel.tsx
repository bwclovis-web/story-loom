import Link from "next/link";
import { MENTIONED_BY } from "@/ui/labels";
import type { MentionedByItem, MentionedByKind } from "@/server/services/mentionedByService";

const KIND_LABEL: Record<MentionedByKind, string> = {
  manuscript_name: MENTIONED_BY.kindManuscriptName,
  cross_ref: MENTIONED_BY.kindCrossRef,
  manuscript_link: MENTIONED_BY.kindLink,
  scene_location: MENTIONED_BY.kindSceneLocation,
  story_event: MENTIONED_BY.kindStoryEvent,
  weave_beat: MENTIONED_BY.kindWeaveBeat,
  map_pin: MENTIONED_BY.kindMapPin,
  board_card: MENTIONED_BY.kindBoardCard,
};

export function MentionedByPanel({ items }: { items: readonly MentionedByItem[] }) {
  if (!items.length) return <p className="small muted">{MENTIONED_BY.none}</p>;
  return (
    <ul className="context-links">
      {items.map((item, index) => (
        <li key={`${item.kind}-${item.href}-${index}`}>
          <Link href={item.href}>{item.title}</Link>{" "}
          <span className="small muted">{KIND_LABEL[item.kind]}</span>
          {item.detail ? <div className="small muted">{item.detail}</div> : null}
        </li>
      ))}
    </ul>
  );
}