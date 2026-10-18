/**
 * Entry point for the lazily loaded editor chunk (`dist/composer.js`).
 *
 * The content script imports this file at runtime with
 * `import(ext.runtime.getURL('composer.js'))`, so CodeMirror never costs
 * anything until the panel is opened; each language then arrives as one more
 * `dist/composer/*` chunk (see `languages.ts`).
 */
export {
  createEditor,
  loadLanguage,
  type EditorHandle,
  type EditorOptions,
} from './editor';
