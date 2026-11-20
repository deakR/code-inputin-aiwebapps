import type { SiteAdapter } from './types';

export const claudeAdapter: SiteAdapter = {
  id: 'claude',
  name: 'Claude',
  editorKind: 'prosemirror',
  supportsDock: false,
  inputSelectors: [
    'div[aria-label*="Write your prompt" i][contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'fieldset div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="Reply" i]',
    'textarea',
  ],
  sendSelectors: [
    'button[aria-label="Send message" i]',
    'button[aria-label="Send Message" i]',
    'button[aria-label^="Send" i]',
    '[data-testid="send-button"]',
  ],
  attachSelectors: [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Add content" i]',
  ],
  composerSelectors: ['fieldset', 'form', '[data-testid="composer"]'],
  theme: { accent: '#d97757', accentDark: '#e7a087' },
  copy: { sent: 'Sent to Claude', insertHint: 'Insert into the prompt box' },
};
