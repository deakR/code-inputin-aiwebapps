import type { SiteAdapter } from './types';

export const chatgptAdapter: SiteAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',
  editorKind: 'prosemirror',
  supportsDock: true,
  inputSelectors: [
    '#prompt-textarea',
    '#mobile-composer-prompt',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[data-testid="prompt-textarea"]',
    'textarea[aria-label*="Chat with ChatGPT" i]',
    'textarea[placeholder*="Ask ChatGPT" i]',
    'textarea[placeholder*="Message" i]',
    'textarea',
  ],
  sendSelectors: [
    '[data-testid="send-button"]',
    '#composer-submit-button',
    'button[aria-label="Send prompt" i]',
    'button[aria-label="Send message" i]',
    'button[aria-label^="Send" i]',
  ],
  attachSelectors: [
    '[data-testid="composer-plus-btn"]',
    'button[aria-label*="Add" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
  ],
  composerSelectors: ['form', '[data-testid="composer"]', '#thread-bottom-container'],
  theme: { accent: '#10a37f', accentDark: '#5fd4b3' },
  copy: { sent: 'Sent to ChatGPT', insertHint: 'Insert into the prompt box' },
  launcherSlot(input) {
    const composer = input.closest('form') ?? input.closest('[data-testid="composer"]');
    if (!(composer instanceof HTMLElement)) return null;

    // Prefer the left tool/attach row. On the signed-out home it is a single
    // 36px button cell with no room for a chip; in that case fall through to
    // the left edge of the trailing row instead of breaking the host layout.
    const attach = composer.querySelector<HTMLElement>(
      '[data-testid="composer-plus-btn"], button[aria-label*="Add files" i], button[aria-label*="Attach" i]',
    );
    let row = attach?.parentElement ?? null;
    for (let depth = 0; row && row !== composer && depth < 3; depth += 1, row = row.parentElement) {
      const rect = row.getBoundingClientRect();
      if (rect.width >= 64 && rect.height >= 24 && !row.contains(input)) {
        return { container: row, edge: 'start' };
      }
    }

    // The left edge of the trailing row is still left of ChatGPT's mic and send
    // controls. The old `end` placement put the chip after the primary action,
    // which is the inconsistency this left preference removes.
    const trailing = composer.querySelector<HTMLElement>('[data-slot="composer-trailing-actions"]');
    const rect = trailing?.getBoundingClientRect();
    if (!trailing || !rect || rect.width === 0 || rect.height === 0) return null;
    return { container: trailing, edge: 'start' };
  },
};
