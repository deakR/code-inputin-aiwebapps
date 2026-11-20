import type { SiteAdapter } from './types';

/**
 * The universal fallback. It is used for local fixtures and for any page the
 * content script is injected into without a named adapter. Its selectors are
 * deliberately broad because the scorer in `content/dom.ts` does the real work.
 */
export const genericAdapter: SiteAdapter = {
  id: 'generic',
  name: 'this page',
  editorKind: 'contenteditable',
  supportsDock: false,
  inputSelectors: [
    'div[role="textbox"][contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][aria-label*="prompt" i]',
    '[contenteditable="true"][aria-label*="message" i]',
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[aria-label*="Message" i]',
    'textarea[aria-label*="prompt" i]',
    'div[contenteditable="true"]',
    'textarea:not([type="search"]):not([type="hidden"])',
  ],
  sendSelectors: [
    '[data-testid="send-button"]',
    '[data-testid="submit-button"]',
    'button[aria-label^="Send" i]',
    'button[aria-label="Submit" i]',
    'button[type="submit"]',
  ],
  attachSelectors: [
    'button[aria-label*="Add" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
  ],
  composerSelectors: ['form', 'main', '[class*="composer"]'],
  theme: { accent: '#1a73e8', accentDark: '#8ab4f8' },
  copy: { sent: 'Sent', insertHint: 'Insert into the prompt box' },
};
