import { BookMarked, ImageIcon, StickyNote } from "lucide-react";
import type { BoardCardKind } from "@/server/services/boardService";

/** Decorative kind marker on board cards and list rows (mockup-style). */
export function BoardCardKindIcon({ kind, className = "board-card-kind-icon" }: { kind: BoardCardKind; className?: string }) {
  const iconProps = { className, strokeWidth: 1.65, "aria-hidden": true as const };
  if (kind === "image") return <ImageIcon {...iconProps} />;
  if (kind === "note") return <StickyNote {...iconProps} />;
  return <BookMarked {...iconProps} />;
}