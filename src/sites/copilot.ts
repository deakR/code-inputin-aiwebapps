import type { SiteAdapter } from './types';

export const copilotAdapter: SiteAdapter = {
  id: 'copilot',
  name: 'Copilot',
  editorKind: 'textarea',
  supportsDock: false,
  inputSelectors: [
    'textarea[data-testid="composer-input"]',
    'textarea#userInput',
    'textarea[placeholder*="Message" i]',
    'textarea[aria-label*="Message" i]',
    'textarea',
  ],
  sendSelectors: [
    'button[aria-label="Submit" i]',
    'button[aria-label*="Send" i]',
    'button[title*="Submit" i]',
    'button[data-testid="submit-button"]',
  ],
  attachSelectors: ['button[aria-label*="Add" i]', 'button[aria-label*="Attach" i]'],
  composerSelectors: ['form', '[data-testid="composer"]', '[class*="composer"]'],
  theme: { accent: '#0f6cbd', accentDark: '#6cb8f6' },
  copy: { sent: 'Sent to Copilot', insertHint: 'Insert into the prompt box' },
};
