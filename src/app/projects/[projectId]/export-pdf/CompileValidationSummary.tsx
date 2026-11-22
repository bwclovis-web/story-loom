import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import type { CompileValidationReport } from "@/server/services/compileValidationService";
import { COMPILE_PROFILE } from "@/ui/labels";

function toneFor(severity: "error" | "warn" | "info"): "error" | "warn" | "info" {
  if (severity === "error") return "error";
  if (severity === "warn") return "warn";
  return "info";
}

export function CompileValidationSummary({ report }: { report: CompileValidationReport }) {
  const errors = report.issues.filter((i) => i.severity === "error");
  const warnings = report.issues.filter((i) => i.severity === "warn");
  const infos = report.issues.filter((i) => i.severity === "info");

  return (
    <section className="panel stack" aria-labelledby="compile-preview-heading">
      <h2 id="compile-preview-heading">{COMPILE_PROFILE.previewHeading}</h2>
      <p className="small muted">{COMPILE_PROFILE.previewIntro}</p>
      <ul className="small" style={{ margin: 0, paddingLeft: "1.25rem" }}>
        <li>
          {COMPILE_PROFILE.previewCounts(report.chapterCount, report.sceneCount, report.wordCount)}
        </li>
        {report.unplacedSceneCount ? (
          <li>{COMPILE_PROFILE.previewUnplaced(report.unplacedSceneCount)}</li>
        ) : null}
        {report.excludedCount ? <li>{COMPILE_PROFILE.previewExcluded(report.excludedCount)}</li> : null}
        {report.hasBackMatter ? <li>{COMPILE_PROFILE.previewBackMatter}</li> : null}
        {report.includeSynopses ? <li>{COMPILE_PROFILE.previewSynopses}</li> : null}
        {report.includeMarginComments ? <li>{COMPILE_PROFILE.previewComments}</li> : null}
      </ul>

      {errors.length || warnings.length || infos.length ? (
        <div className="stack" style={{ gap: "0.5rem" }}>
          {[...errors, ...warnings, ...infos].map((issue) => (
            <Banner key={`${issue.code}-${issue.title}`} tone={toneFor(issue.severity)}>
              <strong>{issue.title}</strong>
              <span className="small"> — {issue.detail}</span>
              {issue.href ? (
                <>
                  {" "}
                  <Link href={issue.href} className="small">
                    {COMPILE_PROFILE.previewOpen}
                  </Link>
                </>
              ) : null}
            </Banner>
          ))}
        </div>
      ) : (
        <Banner tone="ok">{COMPILE_PROFILE.previewClear}</Banner>
      )}

      <p className="small muted">{COMPILE_PROFILE.handoffNote}</p>
    </section>
  );
}
