import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { PDF } from "@/ui/labels";

export function BetaReaderDocxForm({
  docxHref,
  draftId,
}: {
  docxHref: string;
  draftId?: string | null;
}) {
  return (
    <form method="get" action={docxHref} className="stack">
      <input type="hidden" name="beta" value="1" />
      {draftId ? <input type="hidden" name="draft" value={draftId} /> : null}
      <p className="small muted" style={{ margin: 0 }}>
        {PDF.betaReaderIntro}
      </p>
      <Checkbox name="sceneTitles" value="1" label={PDF.sceneTitles} />
      <Checkbox name="lineNumbers" value="1" label={PDF.betaReaderLineNumbers} />
      <Checkbox name="glossary" value="1" label={PDF.betaReaderGlossary} />
      <label className="stack" style={{ gap: "0.25rem" }}>
        <span className="small">{PDF.betaReaderWatermark}</span>
        <input
          type="text"
          name="watermark"
          placeholder={PDF.betaReaderWatermarkPlaceholder}
          maxLength={200}
        />
      </label>
      <Button type="submit" variant="secondary">
        {PDF.betaReaderDownload}
      </Button>
    </form>
  );
}