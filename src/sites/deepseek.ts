import type { SiteAdapter } from './types';

export const deepseekAdapter: SiteAdapter = {
  id: 'deepseek',
  name: 'DeepSeek',
  editorKind: 'textarea',
  supportsDock: true,
  inputSelectors: [
    'textarea#chat-input',
    'textarea[placeholder*="Message DeepSeek" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[aria-label*="Message" i]',
    'textarea',
  ],
  sendSelectors: [
    'button[aria-label*="Send" i]',
    'div[role="button"][aria-label*="Send" i]',
    '[data-testid="send-button"]',
  ],
  attachSelectors: ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]'],
  composerSelectors: ['form', '[class*="chat-input"]', '[class*="composer"]'],
  theme: { accent: '#4d6bfe', accentDark: '#91a7ff' },
  copy: { sent: 'Sent to DeepSeek', insertHint: 'Insert into the prompt box' },
};
