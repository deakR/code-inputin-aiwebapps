/**
 * One handle for the extension APIs.
 *
 * Chrome and Edge expose `chrome.*`; Firefox exposes the same surface as
 * `browser.*`, where every call returns a promise. MV3's `chrome.*` returns
 * promises too, so a single handle keeps the rest of the code identical in all
 * three stores — no callback-style branching anywhere.
 */
export const ext: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ??
  (globalThis as unknown as { chrome: typeof chrome }).chrome;
