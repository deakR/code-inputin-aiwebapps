import type { SiteAdapter } from './types';

/**
 * Gemini's composer is the only one with an explicit dock shape. The box is a
 * CSS grid: the text row in one cell and the action buttons in the others. The
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
    // Keep the chip on the left, next to Gemini's own attach control. The
    // leading row is anchored to the left edge, so buttons growing at the other
    // end cannot drag the chip sideways.
    const leading = box.querySelector<HTMLElement>('.leading-actions-wrapper');
    const leadingRect = leading?.getBoundingClientRect();
    if (leading && leadingRect && leadingRect.width > 0 && leadingRect.height > 0) {
      return { container: leading, edge: 'start' };
    }
    // If the leading row is unavailable, stay on the left side of the trailing
    // controls rather than jumping to the composer's far right.
    const trailing = box.querySelector<HTMLElement>('.trailing-actions-wrapper');
    const trailingRect = trailing?.getBoundingClientRect();
    if (!trailing || !trailingRect || trailingRect.width === 0 || trailingRect.height === 0) return null;
    return { container: trailing, edge: 'start' };
  },
};
