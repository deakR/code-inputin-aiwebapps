import type { SiteAdapter } from './types';

export const perplexityAdapter: SiteAdapter = {
  id: 'perplexity',
  name: 'Perplexity',
  editorKind: 'contenteditable',
  supportsDock: true,
  inputSelectors: [
    'textarea[placeholder*="Ask" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  sendSelectors: [
    'button[aria-label="Submit" i]',
    'button[aria-label*="Send" i]',
    '[data-testid="submit-button"]',
    'button[type="submit"]',
  ],
  attachSelectors: [
    'button[aria-label*="Add files" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
  ],
  composerSelectors: ['form', '[class*="composer"]', '[class*="search"]'],
  theme: { accent: '#20808d', accentDark: '#6fd3df' },
  copy: { sent: 'Sent to Perplexity', insertHint: 'Insert into the prompt box' },
};
