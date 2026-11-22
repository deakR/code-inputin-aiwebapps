/**
 * A site adapter is a set of *hints*, not a hard-coded map.
 *
 * The generic detector (see `content/dom.ts`) can find a prompt box without any
 * of these selectors. Adapters exist to rank the right candidate first, to name
 * the site in copy, and to describe editor-specific insert behaviour.
 */

export type EditorKind = 'quill' | 'prosemirror' | 'textarea' | 'contenteditable';

export interface ComposerShape {
  /** The rounded surface that draws the input box. */
  box: HTMLElement;
  /** The host's own text row, hidden while the editor is docked. */
  row: HTMLElement | null;
  /** Whether a docked editor can safely live inside this shape. */
  dockable: boolean;
}

export interface AdapterSlot {
  container: HTMLElement;
  /**
   * The stable end of the row. The chip is pinned there, so host controls that
   * appear and disappear at the other end cannot drag it sideways.
   */
  edge: 'start' | 'end';
}

export interface SiteAdapter {
  id: string;
  name: string;
  /** Ordered, but only hints: each one is still checked for visibility. */
  inputSelectors: string[];
  sendSelectors: string[];
  attachSelectors: string[];
  /** Container hints used for the floating panel and launcher fallback. */
  composerSelectors: string[];
  editorKind: EditorKind;
  supportsDock: boolean;
  theme: {
    accent: string;
    accentDark: string;
  };
  copy: {
    sent: string;
    insertHint: string;
  };
  /** Optional adapter-specific shape detection. Returning null falls back. */
  composer?: (input: HTMLElement) => ComposerShape | null;
  /** Optional adapter-specific action row for the launcher chip. */
  launcherSlot?: (input: HTMLElement) => AdapterSlot | null;
}
