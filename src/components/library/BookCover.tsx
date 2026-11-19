import { coverMotifForProject, type CoverMotif } from "@/ui/library";

/**
 * Manuscript cover. The app does not store a project cover image, so this
 * draws a deterministic decorative fallback from the project id. Titles are
 * HTML so long names wrap. Treat the whole cover as decorative when the
 * manuscript name is already in adjacent text.
 */
export function BookCover({
  projectId,
  title,
  eyebrow,
  size = "mini",
}: {
  projectId: string;
  title: string;
  eyebrow?: string | null;
  size?: "featured" | "mini";
}) {
  const motif = coverMotifForProject(projectId);
  const kicker = eyebrow?.trim();
  return (
    <div className={`book-cover book-cover-${size}`} data-motif={motif} aria-hidden="true">
      <CoverArt motif={motif} />
      <div className="book-cover-copy">
        {kicker ? <p className="book-cover-kicker">{kicker}</p> : null}
        <p className="book-cover-title">{title}</p>
      </div>
    </div>
  );
}

function CoverArt({ motif }: { motif: CoverMotif }) {
  if (motif === "waves") return <WaveArt />;
  if (motif === "lantern") return <LanternArt />;
  return <ThistleArt />;
}

function ThistleArt() {
  return (
    <svg className="book-cover-art" viewBox="0 0 200 230" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M100 214c-2-34 3-62 0-92" />
        <path d="M99 176c-22-1-46 8-68-4 20-8 42-16 68-8" />
        <path d="M62 170l-9-12M50 166l-11-7M38 160l-8-9" />
        <path d="M101 156c18 1 40 12 62 2-18-10-38-14-62-6" />
        <path d="M136 154l9-11M150 152l11-5" />
        <path d="M98 132c-16-10-28-4-38-16 14 2 26 10 38 18" />
        <path d="M78 122l-7-9" />
        <path d="M100 108c-16 10-24 32-8 48 10 6 26 6 36 0 16-16 8-38-8-48-6 10-12 10-20 0z" />
        <path d="M100 104V78M84 108 66 90M116 108l18-18M74 122 54 114M126 122l20-8M72 140 54 146M128 140l18 6M88 98 76 82M112 98l12-16" />
        <path d="M100 118v24M90 128c7 9 13 9 20 0" />
      </g>
    </svg>
  );
}

function WaveArt() {
  return (
    <svg className="book-cover-art book-cover-art-waves" viewBox="0 0 200 120" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" fill="none">
        <path d="M8 34q28-22 56 0t56 0 56 0" />
        <path d="M8 60q28-22 56 0t56 0 56 0" />
        <path d="M8 86q28-22 56 0t56 0 56 0" />
      </g>
    </svg>
  );
}

function LanternArt() {
  return (
    <svg className="book-cover-art book-cover-art-lantern" viewBox="0 0 140 200" fill="none" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M52 38c0-16 36-16 36 0" />
        <path d="M44 38h52l-8 16H52z" />
        <path d="M48 54h44" />
        <path d="M46 58l8 82h32l8-82z" />
        <path d="M62 58v82M78 58v82" />
        <path d="M50 140h40l6 14H44z" />
        <path d="M70 74c7 12 7 20 0 30-7-10 0-18 0-30z" />
      </g>
    </svg>
  );
}
