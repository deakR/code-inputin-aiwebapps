/**
 * Locating Gemini's prompt box.
 *
 * Gemini is an Angular app and its class names are obfuscated and change often,
 * so we try a priority list of selectors, prefer custom elements and ARIA roles
 * over generated classes, and fall back to the last resort of "any visible
 * contenteditable". Every match is reported back so the popup can show which
 * selector is doing the work when something breaks.
 */

export interface InputMatch {
  element: HTMLElement;
  selector: string;
}

/** Ordered from most to least specific. */
export const INPUT_SELECTORS = [
  'rich-textarea .ql-editor',
  'rich-textarea [contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]',
  '.ql-editor[contenteditable="true"]',
  '[contenteditable="true"][aria-label*="prompt" i]',
  'textarea[data-testid="prompt-input"]',
  'textarea[aria-label*="prompt" i]',
  'textarea[placeholder*="Ask" i]',
  'div[contenteditable="true"]',
  'textarea:not([type="search"]):not([type="hidden"])',
];

export function isVisible(element: Element): boolean {
  const html = element as HTMLElement;
  // checkVisibility covers display:none ancestors and visibility:hidden.
  if (typeof html.checkVisibility === 'function') {
    if (!html.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  }
  const rect = html.getBoundingClientRect();
  if (rect.width < 60 || rect.height < 14) return false;
  if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return false;
  return true;
}

/** Depth-first search that also walks into open shadow roots. */
function deepQueryAll(selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (root: Document | ShadowRoot) => {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (element instanceof HTMLElement) found.push(element);
    }
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const shadow = (element as HTMLElement).shadowRoot;
      if (shadow) visit(shadow);
    }
  };
  visit(document);
  return found;
}

function isCandidate(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false;
  if (element instanceof HTMLTextAreaElement) return !element.disabled;
  return element.isContentEditable;
}

export function findChatInput(): InputMatch | null {
  for (const selector of INPUT_SELECTORS) {
    let candidates: HTMLElement[];
    try {
      // Fast path first: shadow roots are rare, and walking every element on
      // the page on every mutation is expensive.
      const direct = Array.from(document.querySelectorAll(selector)).filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      candidates = direct.length > 0 ? direct : deepQueryAll(selector);
    } catch {
      continue;
    }
    for (const element of candidates) {
      if (!isCandidate(element)) continue;
      if (!isVisible(element)) continue;
      return { element, selector };
    }
  }
  return null;
}

/** The visual container of the prompt box, used to anchor the panel and launcher. */
export function findInputContainer(input: HTMLElement): HTMLElement {
  const rich = input.closest('rich-textarea');
  if (rich instanceof HTMLElement && isVisible(rich)) return rich;
  const parent = input.parentElement;
  if (parent && isVisible(parent)) return parent;
  return input;
}

/**
 * The rounded box Gemini draws around the prompt box, and the row inside it that
 * holds the text area.
 *
 * The box lays itself out as a grid: the text row in one cell, the leading and
 * trailing action buttons in the others — and once the prompt is multi-line it
 * makes that row full width with the buttons underneath. Docking the editor into
 * the grid the same way is what makes it look like the input box itself grew a
 * code editor.
 *
 * Returns `null` when the shape isn't recognised, in which case the panel stays
 * a floating overlay.
 */
export interface ComposerDock {
  /** The grid container that draws the rounded input box. */
  box: HTMLElement;
  /** Gemini's own text row, hidden while the editor is docked. */
  row: HTMLElement;
}

export function findComposerBox(input: HTMLElement): HTMLElement | null {
  // `rich-textarea` carries `text-input-field_textarea`, a different class
  // token, so this cannot stop at the textarea itself.
  const box = input.closest('.text-input-field');
  return box instanceof HTMLElement ? box : null;
}

export function findComposerDock(input: HTMLElement): ComposerDock | null {
  const box = findComposerBox(input);
  if (!box) return null;
  const mainArea = input.closest('.text-input-field-main-area') ?? input.closest('rich-textarea');
  // The row is whatever wraps the text area one level up: its class flips
  // between single-line and multi-line, so it isn't a reliable marker.
  const row = mainArea?.parentElement ?? null;
  if (!(row instanceof HTMLElement)) return null;
  if (row === box || !box.contains(row)) return null;
  return { box, row };
}

/** Current text of the prompt box, or '' when it cannot be read. */
export function readInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement) return input.value;
  return input.innerText ?? input.textContent ?? '';
}

/** Live text of the conversation, used to tell whether the response area rendered. */
export function findModelResponses(): HTMLElement[] {
  const selectors = ['model-response', '.model-response-text', 'message-content', '.response-content'];
  for (const selector of selectors) {
    const nodes = deepQueryAll(selector);
    if (nodes.length > 0) return nodes;
  }
  return [];
}
