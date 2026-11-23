"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { PROJECT_TEMPLATE_IDS, type ProjectTemplateId } from "@/domain/projectTemplates";
import { HOME } from "@/ui/labels";
import { createProjectAction, createWorkspaceAction } from "@/app/(site)/actions";

const TEMPLATE_OPTIONS: { value: ProjectTemplateId; label: string; hint: string }[] = [
  { value: "novel", label: HOME.templateNovel, hint: HOME.templateNovelHint },
  { value: "series", label: HOME.templateSeries, hint: HOME.templateSeriesHint },
  { value: "fantasy", label: HOME.templateFantasy, hint: HOME.templateFantasyHint },
  { value: "science_fiction", label: HOME.templateScienceFiction, hint: HOME.templateScienceFictionHint },
  { value: "mystery", label: HOME.templateMystery, hint: HOME.templateMysteryHint },
  { value: "romance", label: HOME.templateRomance, hint: HOME.templateRomanceHint },
  { value: "screenplay", label: HOME.templateScreenplay, hint: HOME.templateScreenplayHint },
];

export function NewWorkspaceButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function open() {
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function submit(formData: FormData) {
    await createWorkspaceAction(formData);
    dialogRef.current?.close();
  }

  return (
    <>
      <Button type="button" variant="outline" className="library-new-workspace" onClick={open}>
        {HOME.newWorkspaceHeading}
      </Button>
      <dialog ref={dialogRef} className="library-dialog" aria-labelledby={titleId}>
        <form action={submit}>
          <h2 id={titleId}>{HOME.newWorkspaceHeading}</h2>
          <label>
            {HOME.workspaceNamePlaceholder}
            <input name="name" type="text" required autoComplete="off" placeholder={HOME.workspaceNamePlaceholder} />
          </label>
          <div className="row">
            <Button type="submit">{HOME.createWorkspace}</Button>
            <Button type="button" variant="secondary" onClick={close}>
              {HOME.cancel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function NewManuscriptButton({ workspaceId }: { workspaceId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [template, setTemplate] = useState<ProjectTemplateId>("novel");
  const selected = TEMPLATE_OPTIONS.find((option) => option.value === template) ?? TEMPLATE_OPTIONS[0]!;

  function show() {
    setTemplate("novel");
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <Button type="button" variant="ghost" className="library-add" onClick={show}>
        + {HOME.newManuscript}
      </Button>
      <dialog ref={dialogRef} className="library-dialog library-dialog-wide" aria-labelledby={titleId}>
        <form action={createProjectAction}>
          <h2 id={titleId}>{HOME.newManuscript}</h2>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <label>
            {HOME.projectTitlePlaceholder}
            <input name="title" type="text" required autoComplete="off" placeholder={HOME.projectTitlePlaceholder} />
          </label>
          <RadioGroup
            legend={HOME.templateLegend}
            name="template"
            value={template}
            onValueChange={(value) => {
              if ((PROJECT_TEMPLATE_IDS as readonly string[]).includes(value)) {
                setTemplate(value as ProjectTemplateId);
              }
            }}
            hint={selected.hint}
            options={TEMPLATE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          <p className="small muted">{HOME.templateHint}</p>
          <div className="row">
            <Button type="submit">{HOME.addProject}</Button>
            <Button type="button" variant="secondary" onClick={close}>
              {HOME.cancel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
