declare module "typo-js" {
  interface TypoSettings {
    dictionaryPath?: string;
    asyncLoad?: boolean;
    loadedCallback?: (typo: Typo) => void;
  }

  class Typo {
    constructor(dictionary: string, affData?: string | false | null, wordsData?: string | false | null, settings?: TypoSettings);
    loaded: boolean;
    check(word: string): boolean;
    checkExact(word: string): boolean;
    suggest(word: string, limit?: number): string[];
  }

  export default Typo;
}
