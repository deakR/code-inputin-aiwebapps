/**
 * Language metadata and language guessing — no editor imports, so the popup
 * can use this without pulling in CodeMirror.
 */

export interface LanguageMeta {
  id: string;
  label: string;
  /** Label used inside the ``` fence. */
  fence: string;
  /** File extensions that map to this language. */
  extensions: string[];
  /** One unit of indentation for this language (CodeMirror defaults to two spaces otherwise). */
  indent: string;
}

const TAB = '\t';

export const LANGUAGE_META: LanguageMeta[] = [
  { id: 'text', label: 'Plain text', fence: 'text', extensions: ['txt', 'log'], indent: '    ' },
  { id: 'python', label: 'Python', fence: 'python', extensions: ['py', 'pyw', 'pyi'], indent: '    ' },
  {
    id: 'javascript',
    label: 'JavaScript / TypeScript',
    fence: 'javascript',
    extensions: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'],
    indent: '  ',
  },
  { id: 'html', label: 'HTML', fence: 'html', extensions: ['html', 'htm', 'vue'], indent: '  ' },
  { id: 'css', label: 'CSS', fence: 'css', extensions: ['css', 'scss', 'less'], indent: '  ' },
  { id: 'json', label: 'JSON', fence: 'json', extensions: ['json', 'jsonc'], indent: '  ' },
  { id: 'yaml', label: 'YAML', fence: 'yaml', extensions: ['yml', 'yaml'], indent: '  ' },
  { id: 'xml', label: 'XML', fence: 'xml', extensions: ['xml', 'svg', 'plist'], indent: '  ' },
  { id: 'markdown', label: 'Markdown', fence: 'markdown', extensions: ['md', 'mdx'], indent: '  ' },
  { id: 'java', label: 'Java', fence: 'java', extensions: ['java'], indent: '    ' },
  { id: 'kotlin', label: 'Kotlin', fence: 'kotlin', extensions: ['kt', 'kts'], indent: '    ' },
  { id: 'scala', label: 'Scala', fence: 'scala', extensions: ['scala', 'sc'], indent: '  ' },
  { id: 'csharp', label: 'C#', fence: 'csharp', extensions: ['cs'], indent: '    ' },
  {
    id: 'cpp',
    label: 'C / C++',
    fence: 'cpp',
    extensions: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh'],
    indent: '    ',
  },
  { id: 'dart', label: 'Dart', fence: 'dart', extensions: ['dart'], indent: '  ' },
  // gofmt writes tabs; so should we.
  { id: 'go', label: 'Go', fence: 'go', extensions: ['go'], indent: TAB },
  { id: 'rust', label: 'Rust', fence: 'rust', extensions: ['rs'], indent: '    ' },
  { id: 'php', label: 'PHP', fence: 'php', extensions: ['php'], indent: '    ' },
  { id: 'ruby', label: 'Ruby', fence: 'ruby', extensions: ['rb', 'gemspec'], indent: '  ' },
  { id: 'shell', label: 'Shell / Bash', fence: 'bash', extensions: ['sh', 'bash', 'zsh', 'ps1'], indent: '  ' },
  { id: 'sql', label: 'SQL', fence: 'sql', extensions: ['sql'], indent: '  ' },
];

const BY_ID = new Map(LANGUAGE_META.map((language) => [language.id, language]));
const BY_FENCE = new Map(LANGUAGE_META.map((language) => [language.fence, language]));
const BY_EXTENSION = new Map(
  LANGUAGE_META.flatMap((language) => language.extensions.map((extension) => [extension, language])),
);

export function getLanguageMeta(id: string): LanguageMeta {
  return BY_ID.get(id) ?? LANGUAGE_META[0];
}

/** Maps a fence label or file extension to a language id, or null when unknown. */
export function languageIdFor(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/^\./, '');
  return (BY_FENCE.get(key) ?? BY_EXTENSION.get(key))?.id ?? null;
}

/** Best-effort guess used when pasting into an empty editor. */
export function guessLanguage(text: string): string | null {
  const sample = text.trim();
  if (sample.length < 8) return null;

  const fence = /^```+\s*([A-Za-z0-9+#.-]+)/.exec(sample);
  if (fence) {
    const id = languageIdFor(fence[1]);
    if (id) return id;
  }

  const head = sample.slice(0, 2000);
  const tests: Array<[RegExp, string]> = [
    [/^#!\s*\S*\/(bash|sh|zsh)/m, 'shell'],
    [/^#!\s*\S*\/usr\/bin\/env\s+python/m, 'python'],
    [/^<\?php/, 'php'],
    [/^\s*(<!doctype html|<html[\s>])/i, 'html'],
    [/^\s*(\{|\[)\s*"[\w-]"\s*:/, 'json'],
    [/^\s*(FROM|SELECT)\b[\s\S]*\b(FROM|WHERE|JOIN)\b/i, 'sql'],
    [/^\s*---\s*$/m, 'yaml'],
    [/^package\s+main[\s\S]*\bfunc\s+/m, 'go'],
    [/\bfn\s+main\s*\(/, 'rust'],
    [/\b(public|private)\s+(static\s+)?(void|class)\b/, 'java'],
    [/\bnamespace\s+\w+\s*[;{]/, 'csharp'],
    [/\bfun\s+\w+\s*\(.*\)\s*(:|=)/, 'kotlin'],
    [/^\s*#include\s*[<"]/m, 'cpp'],
    [/\bdef\s+\w+\s*\([\s\S]*\)\s*:/, 'python'],
    [/\bimport\s+[\w.]+(\s+as\s+\w+)?\s*$/m, 'python'],
    [/\b(const|let|var|function)\s+[\w$]+\s*(=|\()/, 'javascript'],
    [/\bimport\s+.*\bfrom\s+['"]/, 'javascript'],
    [/=>|\bexport\s+(default\s+)?(function|const|class)\b/, 'javascript'],
    [/\bdef\s+\w+[\s\S]*\bend\s*$/m, 'ruby'],
    [/\$[\w_]+\s*=/, 'php'],
  ];
  for (const [pattern, id] of tests) if (pattern.test(head)) return id;
  return null;
}
