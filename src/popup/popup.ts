import { LANGUAGE_META } from '../composer/language-meta';
import { ext } from '../shared/ext';
import { loadSettings, saveSettings, type LauncherMode } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface DiagStatus {
  adapter?: string;
  adapterName?: string;
  found?: boolean;
  selector?: string | null;
  open?: boolean;
  docked?: boolean;
  launcher?: string;
  repair?: boolean;
  send?: string;
  url?: string;
  health?: Array<{ phase: string; detail?: string; ok: boolean }>;
}

function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * The popup normally talks to the active tab. When the popup is opened as a
 * regular tab (the test harness does this, and some browsers show it that way),
 * the active tab is the popup itself; fall back to the other page tabs and let
 * `sendMessage` decide which one has the content script.
 */
async function pageTabIds(): Promise<number[]> {
  try {
    const tabs = await ext.tabs.query({ currentWindow: true });
    const pages = tabs.filter(
      (tab) => tab.id !== undefined && (!tab.url || /^https?:/i.test(tab.url)),
    );
    pages.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
    return pages.map((tab) => tab.id as number);
  } catch {
    return [];
  }
}

async function sendToPage(type: string): Promise<DiagStatus | null> {
  for (const tabId of await pageTabIds()) {
    try {
      return (await ext.tabs.sendMessage(tabId, { type })) as DiagStatus;
    } catch {
      // Not the page with our content script; try the next one.
    }
  }
  return null;
}

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderStatus(status: DiagStatus | null): void {
  if (!status) {
    setText('status-site', 'Not available on this page');
    setText('status-input', '—');
    setText('status-launcher', '—');
    setText('status-send', '—');
    setText('status-note', 'Open a supported AI chat page, or use Pick prompt box on a page where the extension is active.');
    for (const id of ['pick', 'open-editor']) {
      const button = document.getElementById(id) as HTMLButtonElement | null;
      if (button) button.disabled = true;
    }
    return;
  }

  setText('status-site', status.adapterName ?? status.adapter ?? 'Unknown');
  setText(
    'status-input',
    status.found ? `Found (${status.selector ?? 'auto'})` : 'Not found',
  );
  setText('status-launcher', status.launcher ?? '—');
  setText('status-send', status.send ?? '—');
  const failures = (status.health ?? []).filter((entry) => !entry.ok).length;
  setText(
    'status-note',
    `${status.repair ? 'Custom prompt box saved. ' : ''}${status.health?.length ?? 0} local events, ${failures} failures. Nothing leaves this browser.`,
  );
  for (const id of ['pick', 'open-editor']) {
    const button = document.getElementById(id) as HTMLButtonElement | null;
    if (button) button.disabled = false;
  }
}

async function refreshStatus(): Promise<void> {
  renderStatus(await sendToPage('gci:diag'));
}

async function main(): Promise<void> {
  const versionEl = $('version');
  if (versionEl) {
    versionEl.textContent = `v${ext.runtime.getManifest().version}`;
  }

  const settings = await loadSettings();

  const languageSelect = $<HTMLSelectElement>('language');
  for (const language of LANGUAGE_META) {
    const option = document.createElement('option');
    option.value = language.id;
    option.textContent = language.label;
    languageSelect.appendChild(option);
  }
  languageSelect.value = settings.language;

  const launcher = $<HTMLInputElement>('launcher');
  const placement = $<HTMLSelectElement>('placement');
  const shortcut = $<HTMLSelectElement>('shortcut');

  launcher.checked = settings.showLauncher;
  placement.value = settings.launcherMode;

  // On macOS, display ⌘ and ⌥ instead of Ctrl and Alt in the dropdown options
  if (isMac()) {
    for (const option of shortcut.options) {
      option.textContent =
        option.textContent?.replace('Ctrl', '⌘').replace('Alt', '⌥') ?? option.value;
    }
  }

  // Ensure current stored shortcut is present in the select options
  const activeShortcut = settings.shortcut || 'Ctrl+Shift+E';
  if (!Array.from(shortcut.options).some((o) => o.value === activeShortcut)) {
    const option = document.createElement('option');
    option.value = activeShortcut;
    option.textContent = isMac()
      ? activeShortcut.replace('Ctrl', '⌘').replace('Alt', '⌥')
      : activeShortcut;
    shortcut.appendChild(option);
  }
  shortcut.value = activeShortcut;

  languageSelect.addEventListener('change', () => void saveSettings({ language: languageSelect.value }));
  launcher.addEventListener('change', () => void saveSettings({ showLauncher: launcher.checked }));
  placement.addEventListener('change', () =>
    void saveSettings({ launcherMode: placement.value as LauncherMode }),
  );
  shortcut.addEventListener('change', () => void saveSettings({ shortcut: shortcut.value }));

  $('diag').addEventListener('click', () => void refreshStatus());
  $('pick').addEventListener('click', () => {
    void sendToPage('gci:pick').then(() => window.close());
  });
  $('open-editor').addEventListener('click', () => {
    void sendToPage('gci:open').then(() => window.close());
  });

  await refreshStatus();
}

void main();
