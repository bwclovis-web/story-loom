import Link from "next/link";
import { WORLD } from "@/ui/labels";

export function CanvasReturnBanner({
  back,
}: {
  back: { href: string; label: string } | { unavailable: true } | null;
}) {
  if (!back) return null;
  if ("unavailable" in back) {
    return (
      <p className="canvas-return small muted" role="status">
        {WORLD.canvasReturnMissing}
      </p>
    );
  }
  return (
    <p className="canvas-return">
      <Link href={back.href}>{back.label}</Link>
    </p>
  );
}
