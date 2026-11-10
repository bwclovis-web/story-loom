import { readDictionaryFile } from "@/server/spellDictionaries";
import { SPELLING_LANGUAGES, type SpellingLanguage } from "@/writing/spelling";

/** Serves the standard word lists to the editor's spell checker (a browser worker). */
export async function GET(_request: Request, { params }: { params: Promise<{ language: string; file: string }> }) {
  const { language, file } = await params;
  if (!SPELLING_LANGUAGES.some((l) => l.code === language) || (file !== "aff" && file !== "dic")) {
    return new Response("Not found", { status: 404 });
  }
  try {
    return new Response(readDictionaryFile(language as SpellingLanguage, file), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=86400" },
    });
  } catch {
    return new Response("The dictionary files are missing. Run pnpm install.", { status: 500 });
  }
}
