/**
 * The CodeMirror editor used by the composer.
 *
 * Everything that changes at runtime (language, wrapping, colour scheme) lives
 * in a Compartment so it can be reconfigured without rebuilding the view —
 * that keeps the document, undo history and cursor intact.
 */
import {
  EditorState,
  Compartment,
  Prec,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  closeCompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { getLanguage } from './languages';

const MONO_STACK =
  "'Google Sans Mono', 'Roboto Mono', Consolas, 'Courier New', monospace";

const LIGHT = {
  background: '#ffffff',
  foreground: '#1f1f1f',
  gutter: '#f8f9fa',
  gutterText: '#80868b',
  caret: '#1a73e8',
  selection: 'rgba(26,115,232,0.18)',
  activeLine: 'rgba(26,115,232,0.06)',
  border: '#e3e3e3',
};

const DARK = {
  background: '#1f1f1f',
  foreground: '#e8eaed',
  gutter: '#1f1f1f',
  gutterText: '#9aa0a6',
  caret: '#8ab4f8',
  selection: 'rgba(138,180,248,0.24)',
  activeLine: 'rgba(138,180,248,0.08)',
  border: '#3c4043',
};

function themeExtension(dark: boolean): Extension {
  const palette = dark ? DARK : LIGHT;
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '13px',
        fontFamily: MONO_STACK,
        color: palette.foreground,
        backgroundColor: palette.background,
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: MONO_STACK,
        lineHeight: '1.55',
        overflow: 'auto',
      },
      '.cm-content': { padding: '8px 0', caretColor: palette.caret },
      '.cm-gutters': {
        backgroundColor: palette.gutter,
        color: palette.gutterText,
        border: 'none',
        borderRight: `1px solid ${palette.border}`,
      },
      '.cm-activeLine': { backgroundColor: palette.activeLine },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: palette.foreground },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.caret, borderLeftWidth: '2px' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: palette.selection,
      },
      '.cm-selectionMatch': { backgroundColor: 'rgba(255,193,7,0.28)' },
      '.cm-foldPlaceholder': {
        backgroundColor: palette.gutter,
        color: palette.gutterText,
        border: `1px solid ${palette.border}`,
        padding: '0 4px',
      },
      '.cm-tooltip': {
        backgroundColor: palette.background,
        color: palette.foreground,
        border: `1px solid ${palette.border}`,
        borderRadius: '6px',
        overflow: 'hidden',
      },
      '.cm-panels': {
        backgroundColor: palette.gutter,
        color: palette.foreground,
      },
      '.cm-searchMatch': { backgroundColor: 'rgba(255,193,7,0.35)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255,152,0,0.45)' },
    },
    { dark },
  );
}

export interface EditorOptions {
  parent: HTMLElement;
  /** Loaded with `loadLanguage` before the editor is built — see below. */
  language: Extension;
  wrapLines: boolean;
  dark: boolean;
  /** Content-Security-Policy nonce for the editor's own <style> tag, when one is available. */
  cspNonce?: string;
  placeholderText?: string;
  onChange?: (text: string) => void;
  /** Ctrl/Cmd+Enter in the editor. */
  onInsert?: () => void;
}

export interface EditorHandle {
  view: EditorView;
  getText(): string;
  setText(text: string): void;
  /** Swap in another language extension (load it with `loadLanguage` first). */
  setLanguage(language: Extension): void;
  setWrap(wrapLines: boolean): void;
  setDark(dark: boolean): void;
  /** Dismiss the autocomplete popup (it can reappear when the view is refocused). */
  closeCompletion(): void;
  focus(): void;
  destroy(): void;
}

/**
 * Loads the CodeMirror extension for a language id.
 *
 * Language packages are lazy chunks (see `languages.ts`), so this is async: the
 * panel awaits it *before* it builds the view, which means the first paint is
 * already highlighted and `indentOnInput` works from the very first keystroke.
 */
export async function loadLanguage(id: string): Promise<Extension> {
  const language = getLanguage(id);
  // CodeMirror's indentUnit facet defaults to two spaces; every language here
  // declares its own unit (Go even uses a tab, the way gofmt formats code).
  const unit = indentUnit.of(language.indent);
  if (!language.load) return unit;
  return [await language.load(), unit];
}

export function createEditor(options: EditorOptions): EditorHandle {
  const languageCompartment = new Compartment();
  const wrapCompartment = new Compartment();
  const themeCompartment = new Compartment();

  const startState = EditorState.create({
    doc: '',
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: '⌄', closedText: '›' }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      EditorState.tabSize.of(4),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ activateOnTyping: true, defaultKeymap: true }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      placeholderExtension(options.placeholderText ?? 'Paste or type your code…'),
      ...(options.cspNonce ? [EditorView.cspNonce.of(options.cspNonce)] : []),
      wrapCompartment.of(options.wrapLines ? EditorView.lineWrapping : []),
      themeCompartment.of([
        themeExtension(options.dark),
        syntaxHighlighting(
          options.dark ? oneDarkHighlightStyle : defaultHighlightStyle,
          { fallback: true },
        ),
      ]),
      languageCompartment.of(options.language),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              options.onInsert?.();
              return true;
            },
          },
        ]),
      ),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        { key: 'Mod-/', run: toggleComment },
        { key: 'Mod-Alt-/', run: toggleComment },
        { key: 'Shift-Alt-a', run: toggleComment },
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onChange?.(update.state.doc.toString());
      }),
    ],
  });

  const view = new EditorView({ state: startState, parent: options.parent });

  return {
    view,
    getText: () => view.state.doc.toString(),
    setText: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
    },
    setLanguage: (language) =>
      view.dispatch({ effects: languageCompartment.reconfigure(language) }),
    setWrap: (wrapLines) =>
      view.dispatch({
        effects: wrapCompartment.reconfigure(wrapLines ? EditorView.lineWrapping : []),
      }),
    setDark: (dark) =>
      view.dispatch({
        effects: themeCompartment.reconfigure([
          themeExtension(dark),
          syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, {
            fallback: true,
          }),
        ]),
      }),
    focus: () => view.focus(),
    closeCompletion: () => {
      closeCompletion(view);
    },
    destroy: () => view.destroy(),
  };
}
