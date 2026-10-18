import { LANGUAGE_META } from '../composer/language-meta';
import { ext } from '../shared/ext';
import { loadSettings, saveSettings, type LauncherPosition } from '../shared/settings';

interface Status {
  found: boolean;
  selector: string | null;
  open: boolean;
  /** True while the editor is docked inside Gemini's own prompt box. */
  docked?: boolean;
  url: string;
  send: string;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setStatus(text: string, kind: 'on' | 'off' | 'idle'): void {
  $('status').textContent = text;
  $('dot').className = `dot ${kind === 'idle' ? '' : kind}`.trim();
}

async function candidateTabIds(): Promise<number[]> {
  const tabs = await ext.tabs.query({ currentWindow: true });
  const active = tabs.filter((tab) => tab.active);
  const rest = tabs.filter((tab) => !tab.active).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return [...active, ...rest]
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === 'number');
}

/**
 * The popup usually talks to the active tab, but Gemini may well be sitting in
 * another tab (or the active tab may be one the extension cannot reach, like
 * the popup itself when it is open as a page). Walk the window's tabs — most
 * recently focused first — and use the first one that answers.
 */
async function pingAnyTab(): Promise<{ tabId: number; status: Status } | null> {
  for (const tabId of await candidateTabIds()) {
    try {
      const status = (await ext.tabs.sendMessage(tabId, { type: 'gci:ping' })) as Status | undefined;
      if (status && typeof status.found === 'boolean') return { tabId, status };
    } catch {
      /* no content script in that tab */
    }
  }
  return null;
}

function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function main(): Promise<void> {
  // Which build is loaded: the first thing to ask for in a bug report.
  $('version').textContent = `v${ext.runtime.getManifest().version}`;

  const settings = await loadSettings();

  const languageSelect = $<HTMLSelectElement>('language');
  for (const language of LANGUAGE_META) {
    const option = document.createElement('option');
    option.value = language.id;
    option.textContent = language.label;
    languageSelect.appendChild(option);
  }
  languageSelect.value = settings.language;

  const fence = $<HTMLInputElement>('fence');
  const wrap = $<HTMLInputElement>('wrap');
  const launcher = $<HTMLInputElement>('launcher');
  const position = $<HTMLSelectElement>('position');
  const height = $<HTMLInputElement>('height');
  const heightValue = $('height-value');

  fence.checked = settings.wrapInFence;
  wrap.checked = settings.wrapLines;
  launcher.checked = settings.showLauncher;
  position.value = settings.launcherPosition;
  height.value = String(settings.panelHeight);
  heightValue.textContent = `${settings.panelHeight} px`;

  languageSelect.addEventListener('change', () => void saveSettings({ language: languageSelect.value }));
  fence.addEventListener('change', () => void saveSettings({ wrapInFence: fence.checked }));
  wrap.addEventListener('change', () => void saveSettings({ wrapLines: wrap.checked }));
  launcher.addEventListener('change', () => void saveSettings({ showLauncher: launcher.checked }));
  position.addEventListener('change', () =>
    void saveSettings({ launcherPosition: position.value as LauncherPosition }),
  );
  height.addEventListener('input', () => {
    const value = Number(height.value);
    heightValue.textContent = `${value} px`;
    void saveSettings({ panelHeight: value });
  });

  $('shortcut').textContent = isMac() ? '⌘' : 'Ctrl';

  const openButton = $<HTMLButtonElement>('open');
  const status = await pingAnyTab();
  if (!status) {
    setStatus('No Gemini tab found — open gemini.google.com first.', 'off');
    $('diag').textContent = '';
    return;
  }

  const { tabId } = status;
  openButton.hidden = false;
  openButton.addEventListener('click', async () => {
    try {
      await ext.tabs.sendMessage(tabId, { type: 'gci:open' });
      window.close();
    } catch {
      /* nothing to do */
    }
  });

  openButton.textContent = status.status.open ? 'Focus the code editor' : 'Open the code editor';

  const send = status.status.send ? `send: ${status.status.send}` : 'send: not found';
  const placement = status.status.open
    ? status.status.docked
      ? ' · docked in the prompt box'
      : ' · floating panel'
    : '';
  if (status.status.found) {
    setStatus('Prompt box found — ready.', 'on');
    $('diag').textContent = `matched: ${status.status.selector}${placement} · ${send}`;
  } else {
    setStatus(
      'Gemini is open but the prompt box was not found. Ask Gemini to fix the selectors in src/content/dom.ts.',
      'off',
    );
    $('diag').textContent = 'no selector matched';
  }
}

void main();
