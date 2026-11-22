import type { SiteAdapter } from './types';

/**
 * Gemini's composer is the only one this version docks into. The box is a CSS
 * grid: the text row in one cell and the action buttons in the others. The
 * adapter still returns the box even when the row cannot be identified; the
 * panel then floats instead of docking.
 */
export const geminiAdapter: SiteAdapter = {
  id: 'gemini',
  name: 'Gemini',
  editorKind: 'quill',
  supportsDock: true,
  inputSelectors: [
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
  ],
  sendSelectors: [
    '[data-testid="send-button"]',
    'button.send-button',
    '.send-button',
    'button[aria-label^="Send" i]',
    'button[aria-label*="send message" i]',
  ],
  attachSelectors: [
    '.leading-actions-wrapper button',
    'button[aria-label*="Add files" i]',
    'button[aria-label*="attach" i]',
    'button[aria-label*="plus" i]',
  ],
  composerSelectors: ['.text-input-field', '.input-area', 'chat-window'],
  theme: { accent: '#1a73e8', accentDark: '#8ab4f8' },
  copy: { sent: 'Sent to Gemini', insertHint: 'Insert into the prompt box' },
  composer(input) {
    const box = input.closest('.text-input-field');
    if (!(box instanceof HTMLElement)) return null;
    const main = input.closest('.text-input-field-main-area') ?? input.closest('rich-textarea');
    const row = main?.parentElement ?? null;
    const dockable = row instanceof HTMLElement && row !== box && box.contains(row);
    return { box, row: dockable ? row : null, dockable };
  },
  launcherSlot(input) {
    const box = input.closest('.text-input-field');
    if (!(box instanceof HTMLElement)) return null;
    // Real Gemini swaps the mic/send controls inside the trailing row as the
    // prompt goes from empty to typed. The row is anchored to the right edge
    // of the box, so the chip is pinned to that same outer edge: controls added
    // at the other end grow the row leftwards instead of dragging the chip.
    //
    // Deliberately no `.leading-actions-wrapper` fallback. That wrapper is on the
    // far left; placing there while the trailing row is briefly unmeasurable is
    // what makes the chip jump across the whole composer.
    const container = box.querySelector<HTMLElement>('.trailing-actions-wrapper');
    const rect = container?.getBoundingClientRect();
    if (!container || !rect || rect.width === 0 || rect.height === 0) return null;
    return { container, edge: 'end' };
  },
};
