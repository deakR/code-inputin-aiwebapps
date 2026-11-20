/** Unsaved-code autosave. Local only, one draft per site. */

import { ext } from '../shared/ext';

export interface Draft {
  text: string;
  language: string;
  updatedAt: number;
}

const MAX_DRAFT_LENGTH = 500_000;

function storageKey(): string {
  return `gci:draft:${location.hostname}`;
}

export async function loadDraft(): Promise<Draft | null> {
  try {
    const stored = await ext.storage.local.get(storageKey());
    const value = stored?.[storageKey()] as Draft | undefined;
    if (!value || typeof value.text !== 'string' || value.text.length === 0) return null;
    return value;
  } catch {
    return null;
  }
}

export async function saveDraft(text: string, language: string): Promise<void> {
  if (text.length > MAX_DRAFT_LENGTH) return;
  try {
    if (text.trim().length === 0) {
      await ext.storage.local.remove(storageKey());
      return;
    }
    const draft: Draft = { text, language, updatedAt: Date.now() };
    await ext.storage.local.set({ [storageKey()]: draft });
  } catch {
    /* drafts are best-effort */
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await ext.storage.local.remove(storageKey());
  } catch {
    /* ignore */
  }
}
