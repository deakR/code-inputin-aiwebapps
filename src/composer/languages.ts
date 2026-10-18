/**
 * CodeMirror language loaders, keyed by the ids in `./language-meta`.
 *
 * Every language sits behind a dynamic `import()`, so esbuild emits one chunk
 * per language (see `chunkNames` in `build.mjs`): opening the editor fetches the
 * core plus the language that is actually selected, and nothing else. `editor.ts`
 * awaits these loaders before it builds the view.
 */
import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { LANGUAGE_META, type LanguageMeta } from './language-meta';

export interface LanguageDef extends LanguageMeta {
  /** Null means plain text. */
  load: (() => Promise<Extension>) | null;
}

type LegacyMode = Parameters<typeof StreamLanguage.define>[0];

/** A stream-mode language (clike & friends), in its own chunk. */
const legacy = (mode: () => Promise<LegacyMode>): (() => Promise<Extension>) => async () =>
  StreamLanguage.define(await mode()) as Extension;

const LOADERS: Record<string, () => Promise<Extension>> = {
  python: async () => (await import('@codemirror/lang-python')).python(),
  javascript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ typescript: true, jsx: true });
  },
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  java: async () => (await import('@codemirror/lang-java')).java(),
  cpp: async () => (await import('@codemirror/lang-cpp')).cpp(),
  go: async () => (await import('@codemirror/lang-go')).go(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  php: async () => (await import('@codemirror/lang-php')).php(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  yaml: legacy(async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml),
  kotlin: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).kotlin),
  scala: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).scala),
  csharp: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).csharp),
  dart: legacy(async () => (await import('@codemirror/legacy-modes/mode/clike')).dart),
  ruby: legacy(async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby),
  shell: legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell),
};

export const LANGUAGES: LanguageDef[] = LANGUAGE_META.map((meta) => ({
  ...meta,
  load: LOADERS[meta.id] ?? null,
}));

const BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));

export function getLanguage(id: string): LanguageDef {
  return BY_ID.get(id) ?? LANGUAGES[0];
}

export { guessLanguage, languageIdFor } from './language-meta';
