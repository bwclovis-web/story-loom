"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { WEAVE_SURFACES, type WeaveSurface } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { setWeavePreferredSurfaceAction } from "./actions";

const LABELS: Record<WeaveSurface, string> = {
  beat_sheet: WEAVE.surfaceBeatSheet,
  story_grid: WEAVE.surfaceStoryGrid,
  chapter_grid: WEAVE.surfaceChapterGrid,
  freeform: WEAVE.surfaceFreeform,
};

export function WeaveSurfaceToggle({
  projectId,
  gridId,
  surface,
}: {
  projectId: string;
  gridId: string;
  surface: WeaveSurface;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="weave-surface-toggle" role="group" aria-label={WEAVE.surfaceToggle}>
      {WEAVE_SURFACES.map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={value === surface ? "primary" : "secondary"}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await setWeavePreferredSurfaceAction(projectId, gridId, value);
              router.refresh();
            })
          }
        >
          {LABELS[value]}
        </Button>
      ))}
    </div>
  );
}
