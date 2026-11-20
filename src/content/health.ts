/** A tiny local health log. No telemetry, no network — only for the popup. */

export interface HealthEntry {
  at: number;
  phase: string;
  detail?: string;
  ok: boolean;
}

const MAX_ENTRIES = 60;
const entries: HealthEntry[] = [];

export function recordHealth(phase: string, detail?: string, ok = true): void {
  entries.push({ at: Date.now(), phase, detail, ok });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function healthReport(): HealthEntry[] {
  return entries.slice();
}

export function clearHealth(): void {
  entries.length = 0;
}
