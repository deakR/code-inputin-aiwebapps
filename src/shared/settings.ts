import { ext } from './ext';

export type LauncherPosition =
  | 'above-left'
  | 'inside-left'
  | 'inside-right'
  | 'fixed-bottom-right';

export interface Settings {
  /** Default language id for a fresh editor session. */
  language: string;
  /** Wrap the code in a ```fence block when inserting. */
  wrapInFence: boolean;
  /** Wrap long lines inside the editor. */
  wrapLines: boolean;
  /** Show the floating launcher pill next to the prompt box. */
  showLauncher: boolean;
  launcherPosition: LauncherPosition;
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
  launcherPosition: 'above-left',
  panelHeight: 340,
  panelWidth: 760,
};

const STORAGE_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await ext.storage.sync.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Settings> | undefined;
    return { ...DEFAULT_SETTINGS, ...(value ?? {}) };
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
    callback({ ...DEFAULT_SETTINGS, ...(value ?? {}) });
  };
  ext.storage.onChanged.addListener(listener);
  return () => ext.storage.onChanged.removeListener(listener);
}
