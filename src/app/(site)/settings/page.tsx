import { HelpHint } from "@/components/HelpHint";
import { getAssistantConfig } from "@/server/assistantConfig";
import { SETTINGS } from "@/ui/labels";
import { loadSettingsViewAction } from "./actions";
import { AssistantSettingsForm, LibrarySettingsForm, MirrorSettingsForm, SettingsLinks } from "./SettingsForms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const view = await loadSettingsViewAction();
  const { status } = getAssistantConfig();

  return (
    <>
      <h1>{SETTINGS.heading}</h1>
      <p className="muted">{SETTINGS.lead}</p>
      <HelpHint anchor="settings" topic="Settings">
        Add your own OpenAI API key here. Library and backup mirror folders are optional.
      </HelpHint>
      <SettingsLinks />

      <section className="panel stack" aria-labelledby="settings-ai">
        <h2 id="settings-ai" style={{ marginTop: 0 }}>
          {SETTINGS.aiHeading}
        </h2>
        <HelpHint anchor="assistant-setup" topic="assistant setup">
          The key stays on this computer. Settings overrides .env when a value is saved here.
        </HelpHint>
        {status.configured ? (
          <p className="small muted">
            Assistant is configured{status.model ? ` (model ${status.model})` : ""}.
          </p>
        ) : (
          <ul className="small muted">
            {status.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <AssistantSettingsForm keySaved={view.keySaved} model={view.model} secretsPath={view.secretsPath} />
      </section>

      <section className="panel stack" aria-labelledby="settings-library">
        <h2 id="settings-library" style={{ marginTop: 0 }}>
          {SETTINGS.libraryHeading}
        </h2>
        <LibrarySettingsForm
          libraryDir={view.libraryDir}
          fromEnv={view.libraryFromEnv}
          settingsPath={view.librarySettingsPath}
          databasePath={view.databasePath}
          lockStatus={view.lockStatus}
          lockDetail={view.lockDetail}
        />
      </section>

      <section className="panel stack" aria-labelledby="settings-mirror">
        <h2 id="settings-mirror" style={{ marginTop: 0 }}>
          {SETTINGS.mirrorHeading}
        </h2>
        <MirrorSettingsForm
          mirrorDir={view.mirrorDir}
          fromEnv={view.mirrorFromEnv}
          settingsPath={view.mirrorSettingsPath}
        />
      </section>
    </>
  );
}
