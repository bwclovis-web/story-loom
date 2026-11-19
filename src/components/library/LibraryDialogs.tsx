"use client";

import { useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { HOME } from "@/ui/labels";
import { createProjectAction, createWorkspaceAction } from "@/app/(site)/actions";

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

  function show() {
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
      <dialog ref={dialogRef} className="library-dialog" aria-labelledby={titleId}>
        <form action={createProjectAction}>
          <h2 id={titleId}>{HOME.newManuscript}</h2>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <label>
            {HOME.projectTitlePlaceholder}
            <input name="title" type="text" required autoComplete="off" placeholder={HOME.projectTitlePlaceholder} />
          </label>
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
