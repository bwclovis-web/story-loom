"use client";

import { WRITING } from "@/ui/labels";
import { SPELLING_LANGUAGES, spellingCookie, type SpellingLanguage } from "@/writing/spelling";

export function SpellingLanguageSelect({
  value,
  onChange,
}: {
  value: SpellingLanguage;
  onChange: (language: SpellingLanguage) => void;
}) {
  return (
    <label className="inline">
      {WRITING.spellingLanguage}
      <select
        value={value}
        onChange={(e) => {
          const language = e.target.value as SpellingLanguage;
          document.cookie = spellingCookie(language);
          onChange(language);
        }}
      >
        {SPELLING_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
