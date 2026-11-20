import { ext } from './ext';

/**
 * `auto` docks the chip into the site's own composer actions. `floating` keeps
 * it in the viewport corner for sites where the composer cannot take a child.
 * There is deliberately no coordinate picker: that was the source of the
 * inconsistent placements in v1.
 */
export type LauncherMode = 'auto' | 'floating';

export interface Settings {
  /** Default language id for a fresh editor session. */
  language: string;
  /** Wrap the code in a ```fence block when inserting. */
  wrapInFence: boolean;
  /** Wrap long lines inside the editor. */
  wrapLines: boolean;
  /** Show the code launcher in the composer. */
  showLauncher: boolean;
  launcherMode: LauncherMode;
  /** Shortcut combo to toggle editor, e.g. 'Ctrl+Shift+E'. */
  shortcut: string;
  /**
   * Editor height in CSS pixels. Docked in the prompt box the editor grows with
   * the code (about four lines when it is nearly empty) and this is the cap at
   * which it starts scrolling; the floating fallback uses it as its height.
   */
  panelHeight: number;
  /** Preferred panel width in CSS pixels, used only by the floating fallback. */
  panelWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'python',
  wrapInFence: true,
  wrapLines: false,
  showLauncher: true,
  launcherMode: 'auto',
  shortcut: 'Ctrl+Shift+E',
  panelHeight: 340,
  panelWidth: 760,
};

export interface KeyMatchTarget {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key?: string;
  code?: string;
}

/** Matches a keyboard event against a shortcut string like 'Ctrl+Shift+E' or 'Alt+Shift+C'. */
export function matchesShortcut(event: KeyMatchTarget, shortcut: string): boolean {
  if (!shortcut) return false;
  const parts = shortcut.split('+').map((s) => s.trim().toLowerCase());
  const needCtrl = parts.some((p) => p === 'ctrl' || p === 'control' || p === 'cmd' || p === 'command' || p === 'mod');
  const needAlt = parts.some((p) => p === 'alt' || p === 'option');
  const needShift = parts.some((p) => p === 'shift');
  const keyPart = parts.find((p) => !['ctrl', 'control', 'cmd', 'command', 'mod', 'alt', 'option', 'shift'].includes(p));

  const hasCtrl = Boolean(event.ctrlKey || event.metaKey);
  if (needCtrl !== hasCtrl) return false;
  if (needAlt !== Boolean(event.altKey)) return false;
  if (needShift !== Boolean(event.shiftKey)) return false;

  if (!keyPart) return false;

  if (keyPart === 'space') {
    return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
  }

  const keyLower = event.key?.toLowerCase();
  const codeLower = event.code?.toLowerCase();
  return keyLower === keyPart || codeLower === `key${keyPart}` || codeLower === keyPart;
}

const STORAGE_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await ext.storage.sync.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Settings> | undefined;
    const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
    // v1 stored coordinate placements; `auto` is the safe migration.
    if (merged.launcherMode !== 'auto' && merged.launcherMode !== 'floating') {
      merged.launcherMode = 'auto';
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await ext.storage.sync.set({ [STORAGE_KEY]: { ...current, ...patch } });
}

/** Subscribes to settings changes. Returns an unsubscribe function. */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'sync' || !changes[STORAGE_KEY]) return;
    const value = changes[STORAGE_KEY].newValue as Partial<Settings> | undefined;
    const merged = { ...DEFAULT_SETTINGS, ...(value ?? {}) };
    if (merged.launcherMode !== 'auto' && merged.launcherMode !== 'floating') {
      merged.launcherMode = 'auto';
    }
    callback(merged);
  };
  ext.storage.onChanged.addListener(listener);
  return () => ext.storage.onChanged.removeListener(listener);
}
