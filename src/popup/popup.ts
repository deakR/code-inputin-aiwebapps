import { LANGUAGE_META } from '../composer/language-meta';
import { ext } from '../shared/ext';
import { loadSettings, saveSettings, type LauncherPosition } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function isMac(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
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
  const position = $<HTMLSelectElement>('position');
  const shortcut = $<HTMLSelectElement>('shortcut');

  launcher.checked = settings.showLauncher;
  position.value = settings.launcherPosition;

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
  position.addEventListener('change', () =>
    void saveSettings({ launcherPosition: position.value as LauncherPosition }),
  );
  shortcut.addEventListener('change', () => void saveSettings({ shortcut: shortcut.value }));
}

void main();
