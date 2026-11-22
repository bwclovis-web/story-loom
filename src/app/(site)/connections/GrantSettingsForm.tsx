"use client";

import { useActionState } from "react";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { CONNECTIONS } from "@/ui/labels";
import { saveGrantSettingsAction } from "./actions";

export interface GrantFormWorkspace {
  id: string;
  name: string;
  projects: { id: string; title: string }[];
}

export function GrantSettingsForm({
  workspaces,
  active,
  projectIds,
  manuscriptRead,
}: {
  workspaces: GrantFormWorkspace[];
  active: boolean;
  projectIds: string[];
  manuscriptRead: boolean;
}) {
  const [state, dispatch, pending] = useActionState(saveGrantSettingsAction, null);
  const allowed = new Set(projectIds);

  return (
    <form onSubmit={submitWithoutReset(dispatch)} className="stack grant-settings">
      <Checkbox name="active" defaultChecked={active} label={<strong>{CONNECTIONS.grantActive}</strong>} />
      <p className="small muted">{CONNECTIONS.grantActiveHint}</p>

      <fieldset>
        <legend>{CONNECTIONS.grantProjects}</legend>
        {workspaces.every((w) => w.projects.length === 0) ? <p className="muted">{CONNECTIONS.grantNoProjects}</p> : null}
        {workspaces
          .filter((w) => w.projects.length > 0)
          .map((w) => (
            <div key={w.id} className="grant-workspace">
              <p className="small muted">{w.name}</p>
              {w.projects.map((p) => (
                <Checkbox key={p.id} name="projectId" value={p.id} defaultChecked={allowed.has(p.id)} label={p.title} />
              ))}
            </div>
          ))}
      </fieldset>

      <Checkbox name="manuscriptRead" defaultChecked={manuscriptRead} label={CONNECTIONS.grantManuscript} />
      <p className="small muted">{CONNECTIONS.grantManuscriptHint}</p>

      <div className="row">
        <Button type="submit" disabled={pending}>
          {pending ? CONNECTIONS.grantSaving : CONNECTIONS.grantSave}
        </Button>
      </div>
      {state ? <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}
