import type { SiteAdapter } from './types';

export const chatgptAdapter: SiteAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',
  editorKind: 'prosemirror',
  supportsDock: false,
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
};
