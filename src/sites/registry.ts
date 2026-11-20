import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { copilotAdapter } from './copilot';
import { deepseekAdapter } from './deepseek';
import { genericAdapter } from './generic';
import { geminiAdapter } from './gemini';
import hosts from './hosts.json';
import { perplexityAdapter } from './perplexity';
import type { SiteAdapter } from './types';

export const SITE_ADAPTERS: SiteAdapter[] = [
  geminiAdapter,
  chatgptAdapter,
  claudeAdapter,
  deepseekAdapter,
  copilotAdapter,
  perplexityAdapter,
];

const BY_ID = new Map(SITE_ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function adapterById(id: string | null | undefined): SiteAdapter | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function isLocalHost(hostname = location.hostname): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function hostMatches(pattern: string, hostname: string): boolean {
  try {
    const expected = new URL(pattern.replace(/\*$/, '')).hostname;
    return hostname === expected || hostname.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

/**
 * The fixture pages declare their adapter with a meta tag so the same built
 * content script can exercise every adapter locally. Real pages are matched by
 * hostname from `hosts.json`.
 */
export function getAdapterForPage(): SiteAdapter | null {
  const meta = document
    .querySelector('meta[name="gci-site"]')
    ?.getAttribute('content')
    ?.trim();
  if (meta) return adapterById(meta) ?? genericAdapter;

  if (isLocalHost()) return null;

  const hostname = location.hostname;
  for (const adapter of SITE_ADAPTERS) {
    const patterns = (hosts.sites as Record<string, string[]>)[adapter.id] ?? [];
    if (patterns.some((pattern) => hostMatches(pattern, hostname))) return adapter;
  }
  return null;
}
