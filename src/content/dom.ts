/**
 * Locating the prompt box — defensively.
 *
 * No single selector is allowed to be the only way in. Detection runs through a
 * ladder:
 *
 *   1. adapter hints (fast, specific)
 *   2. a user-picked descriptor saved for this site (survives redesigns)
 *   3. the editable element the user last focused (intent as a locator)
 *   4. a generic candidate scorer over every editable element on the page
 *
 * The same "hint, then relationship, then score" approach is used for the send
 * button and for the action row the launcher docks into.
 */

import { ext } from '../shared/ext';
import { genericAdapter } from '../sites/generic';
import type { ComposerShape, SiteAdapter } from '../sites/types';

export interface InputMatch {
  element: HTMLElement;
  /** Human-readable provenance for diagnostics. */
  selector: string;
}

let activeAdapter: SiteAdapter = genericAdapter;

export function setActiveAdapter(adapter: SiteAdapter): void {
  activeAdapter = adapter;
}

export function getActiveAdapter(): SiteAdapter {
  return activeAdapter;
}

/* ── visibility and candidate helpers ───────────────────────────────────── */

export function isVisible(element: Element, minWidth = 1, minHeight = 1): boolean {
  const html = element as HTMLElement;
  if (typeof html.checkVisibility === 'function') {
    if (!html.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  }
  const rect = html.getBoundingClientRect();
  if (rect.width < minWidth || rect.height < minHeight) return false;
  if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return false;
  return true;
}

export function isEditableElement(element: Element): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) return false;
  return element instanceof HTMLElement && element.isContentEditable;
}

function isCandidate(element: Element): element is HTMLElement {
  if (!isEditableElement(element)) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

function isOurElement(element: Element): boolean {
  if (element.closest('#gci-root, #gci-inbox, #gci-overlay')) return true;
  const root = element.getRootNode();
  if (root instanceof ShadowRoot && /^gci-/.test(root.host?.id ?? '')) return true;
  return false;
}

/** Depth-first search that also walks into open shadow roots. */
export function deepQueryAll(selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (root: Document | ShadowRoot) => {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (element instanceof HTMLElement) found.push(element);
    }
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const shadow = (element as HTMLElement).shadowRoot;
      if (shadow) visit(shadow);
    }
  };
  visit(document);
  return found.filter((element) => !isOurElement(element));
}

function queryAll(selector: string): HTMLElement[] {
  const direct = Array.from(document.querySelectorAll(selector)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  if (direct.length > 0) return direct.filter((element) => !isOurElement(element));
  return deepQueryAll(selector);
}

const CANDIDATE_SELECTOR =
  'textarea, [contenteditable="true"], [role="textbox"][contenteditable="true"]';

/** Direct query is fast; the deep walk only happens when the page hides its composer. */
function collectCandidates(): HTMLElement[] {
  const direct = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && isCandidate(element),
  );
  if (direct.length > 0) return direct.filter((element) => !isOurElement(element));
  return deepQueryAll(CANDIDATE_SELECTOR).filter(isCandidate);
}

/* ── prompt-box detection ───────────────────────────────────────────────── */

function findByHints(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    let candidates: HTMLElement[];
    try {
      candidates = queryAll(selector);
    } catch {
      continue;
    }
    for (const element of candidates) {
      if (!isCandidate(element)) continue;
      if (!isVisible(element, 60, 14)) continue;
      return element;
    }
  }
  return null;
}

function labelOfInput(element: HTMLElement): string {
  return [
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.getAttribute('data-placeholder'),
    element.getAttribute('data-testid'),
    element.id,
    element.className?.toString(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function looksLikeSearch(element: HTMLElement): boolean {
  return /search|filter|find|rename|title|subject|email/.test(labelOfInput(element));
}

function isSendLike(element: Element): boolean {
  const label = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-testid'),
    element.id,
    element.className?.toString(),
    element.textContent?.trim().slice(0, 30),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /send|submit/.test(label) && !/feedback|comment|report|email|share/.test(label);
}

function hasActionButtonNear(element: HTMLElement): boolean {
  let node: HTMLElement | null = element.parentElement;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const buttons = node.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const button of buttons) {
      if (isSendLike(button) && isVisible(button, 4, 4)) return true;
    }
  }
  return false;
}

export function scoreComposerCandidate(element: HTMLElement): number {
  if (!isCandidate(element) || !isVisible(element, 60, 14)) return -Infinity;
  if (isOurElement(element)) return -Infinity;

  const label = labelOfInput(element);
  let score = 20;

  if (/prompt|ask|message|chat|reply|compose|query|type|what|how/.test(label)) score += 25;
  if (element instanceof HTMLTextAreaElement) score += 10;
  if (element.isContentEditable) score += 8;

  const rect = element.getBoundingClientRect();
  if (rect.width > 250) score += 10;
  if (rect.top > window.innerHeight * 0.35) score += 10;
  if (element.closest('form')) score += 12;
  if (hasActionButtonNear(element)) score += 25;
  if (document.activeElement === element) score += 20;
  if (lastFocusedComposer === element) score += 30;

  if (looksLikeSearch(element)) score -= 60;
  if (element.closest('header, nav, aside')) score -= 25;
  if (element.closest('[aria-hidden="true"]')) score -= 80;

  return score;
}

function findByScoring(): { element: HTMLElement; score: number } | null {
  const candidates = collectCandidates()
    .filter((element) => !looksLikeSearch(element))
    .map((element) => ({ element, score: scoreComposerCandidate(element) }))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 35) return null;
  return best;
}

let lastFocusedComposer: HTMLElement | null = null;

/** Remembers the editable the user actually clicked, even if every selector missed. */
export function rememberFocusedComposer(element: EventTarget | null): void {
  if (!(element instanceof HTMLElement)) return;
  if (isOurElement(element) || !isCandidate(element)) return;
  if (!isVisible(element, 60, 14)) return;
  if (looksLikeSearch(element)) return;
  lastFocusedComposer = element;
}

export function getLastFocusedComposer(): HTMLElement | null {
  if (!lastFocusedComposer?.isConnected) return null;
  if (!isVisible(lastFocusedComposer, 60, 14)) return null;
  return lastFocusedComposer;
}

export function findChatInput(): InputMatch | null {
  const adapter = getActiveAdapter();

  // A user-picked element is authoritative: it is how a user corrects a page
  // where a decoy (a search box, a hidden editor) wins the hint list.
  const repaired = findByDescriptor();
  if (repaired) return { element: repaired, selector: 'picked' };

  const hinted = findByHints(adapter.inputSelectors);
  if (hinted) return { element: hinted, selector: `${adapter.id}:hint` };

  const focused = getLastFocusedComposer();
  if (focused && scoreComposerCandidate(focused) >= 20) {
    return { element: focused, selector: 'focus' };
  }

  const scored = findByScoring();
  if (scored) return { element: scored.element, selector: `score:${scored.score}` };

  return null;
}

/* ── user-picked descriptor ─────────────────────────────────────────────── */

interface ElementSignature {
  tag: string;
  role?: string;
  testId?: string;
  aria?: string;
  classes: string[];
}

export interface ElementDescriptor {
  v: 1;
  tag: string;
  role?: string;
  testId?: string;
  aria?: string;
  placeholder?: string;
  id?: string;
  classes: string[];
  ancestors: ElementSignature[];
  anchor?: { kind: 'send' | 'attach'; aria?: string; testId?: string; text?: string };
  siblingIndex?: number;
}

let repairDescriptor: ElementDescriptor | null = null;

function repairStorageKey(): string {
  // Local fixtures share a hostname; keep their repairs separate.
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? `gci:repair:${location.host}${location.pathname}`
    : `gci:repair:${location.host}`;
}

function stableClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter(
      (token) =>
        token.length >= 3 &&
        token.length <= 40 &&
        /^[a-zA-Z][\w-]*$/.test(token) &&
        !/\d{4,}/.test(token),
    )
    .slice(0, 4);
}

function signatureOf(element: Element): ElementSignature {
  return {
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role') ?? undefined,
    testId: element.getAttribute('data-testid') ?? undefined,
    aria: element.getAttribute('aria-label') ?? undefined,
    classes: stableClasses(element),
  };
}

function nearbyAnchor(element: HTMLElement): ElementDescriptor['anchor'] {
  let node: HTMLElement | null = element.parentElement;
  for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
    const buttons = node.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const button of buttons) {
      if (!isVisible(button, 4, 4)) continue;
      if (isSendLike(button)) {
        return {
          kind: 'send',
          aria: button.getAttribute('aria-label') ?? undefined,
          testId: button.getAttribute('data-testid') ?? undefined,
          text: button.textContent?.trim().slice(0, 30) || undefined,
        };
      }
    }
  }
  return undefined;
}

export function describeElement(element: HTMLElement): ElementDescriptor {
  const ancestors: ElementSignature[] = [];
  let node = element.parentElement;
  for (let depth = 0; node && node !== document.body && depth < 4; depth += 1, node = node.parentElement) {
    ancestors.push(signatureOf(node));
  }
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter(
        (child) => child instanceof HTMLElement && isCandidate(child),
      )
    : [];
  return {
    v: 1,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role') ?? undefined,
    testId: element.getAttribute('data-testid') ?? undefined,
    aria: element.getAttribute('aria-label') ?? undefined,
    placeholder: element.getAttribute('placeholder') ?? undefined,
    id: element.id || undefined,
    classes: stableClasses(element),
    ancestors,
    anchor: nearbyAnchor(element),
    siblingIndex: siblings.indexOf(element),
  };
}

function attributeScore(actual: string | null, expected: string | undefined, weight: number): number {
  if (!expected) return 0;
  if (!actual) return 0;
  if (actual === expected) return weight;
  if (actual.toLowerCase().includes(expected.toLowerCase())) return Math.max(1, weight - 2);
  return 0;
}

function signatureScore(actual: Element, expected: ElementSignature): number {
  if (actual.tagName.toLowerCase() !== expected.tag) return 0;
  let score = 1;
  score += attributeScore(actual.getAttribute('role'), expected.role, 2);
  score += attributeScore(actual.getAttribute('data-testid'), expected.testId, 2);
  score += attributeScore(actual.getAttribute('aria-label'), expected.aria, 2);
  const classes = stableClasses(actual);
  score += expected.classes.filter((token) => classes.includes(token)).length;
  return score;
}

export function matchDescriptor(element: HTMLElement, descriptor: ElementDescriptor): number {
  if (element.tagName.toLowerCase() !== descriptor.tag) return 0;

  let score = 0;
  score += attributeScore(element.id, descriptor.id, 8);
  score += attributeScore(element.getAttribute('data-testid'), descriptor.testId, 8);
  score += attributeScore(element.getAttribute('role'), descriptor.role, 5);
  score += attributeScore(element.getAttribute('aria-label'), descriptor.aria, 7);
  score += attributeScore(element.getAttribute('placeholder'), descriptor.placeholder, 6);

  const classes = stableClasses(element);
  score += descriptor.classes.filter((token) => classes.includes(token)).length * 2;

  let node = element.parentElement;
  for (const expected of descriptor.ancestors) {
    let best = 0;
    let probe = node;
    for (let depth = 0; probe && depth < 4; depth += 1, probe = probe.parentElement) {
      best = Math.max(best, signatureScore(probe, expected));
    }
    score += best;
    node = node?.parentElement ?? null;
  }

  if (descriptor.siblingIndex !== undefined && element.parentElement) {
    const siblings = Array.from(element.parentElement.children).filter(
      (child) => child instanceof HTMLElement && isCandidate(child),
    );
    if (siblings[descriptor.siblingIndex] === element) score += 3;
  }

  return score;
}

function findByDescriptor(): HTMLElement | null {
  if (!repairDescriptor) return null;
  // A picked element can live in a shadow root even when the page also has
  // ordinary editables, so this rare path always walks the deep tree.
  const candidates = deepQueryAll(CANDIDATE_SELECTOR)
    .filter(isCandidate)
    .filter((element) => isVisible(element, 60, 14));
  let best: { element: HTMLElement; score: number } | null = null;
  for (const element of candidates) {
    const score = matchDescriptor(element, repairDescriptor);
    if (!best || score > best.score) best = { element, score };
  }
  return best && best.score >= 7 ? best.element : null;
}

export async function loadRepairDescriptor(): Promise<void> {
  try {
    const stored = await ext.storage.local.get(repairStorageKey());
    const value = stored?.[repairStorageKey()] as ElementDescriptor | undefined;
    repairDescriptor = value?.v === 1 ? value : null;
  } catch {
    repairDescriptor = null;
  }
}

export async function saveRepairDescriptor(element: HTMLElement): Promise<void> {
  repairDescriptor = describeElement(element);
  try {
    await ext.storage.local.set({ [repairStorageKey()]: repairDescriptor });
  } catch {
    /* the in-memory descriptor still works for this page */
  }
}

export async function clearRepairDescriptor(): Promise<void> {
  repairDescriptor = null;
  try {
    await ext.storage.local.remove(repairStorageKey());
  } catch {
    /* ignore */
  }
}

export function hasRepairDescriptor(): boolean {
  return repairDescriptor !== null;
}

/* ── composer shapes ────────────────────────────────────────────────────── */

/** The visual container of the prompt box, used to anchor the panel and launcher. */
export function findInputContainer(input: HTMLElement): HTMLElement {
  const shape = activeAdapter.composer?.(input);
  if (shape?.box) return shape.box;

  for (const selector of activeAdapter.composerSelectors) {
    const container = input.closest(selector);
    if (container instanceof HTMLElement && container !== input && isVisible(container, 40, 20)) {
      return container;
    }
  }

  const rich = input.closest('rich-textarea');
  if (rich instanceof HTMLElement && isVisible(rich, 40, 20)) return rich;

  let node: HTMLElement | null = input.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    if (!isVisible(node, 40, 20)) continue;
    const rect = node.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    if (rect.width >= inputRect.width && rect.height >= inputRect.height) return node;
  }
  return input;
}

/** The rounded input box (not just the editable) on any adapter. */
export function findComposerBox(input: HTMLElement): HTMLElement | null {
  const shape = activeAdapter.composer?.(input);
  if (shape?.box) return shape.box;

  for (const selector of activeAdapter.composerSelectors) {
    const box = input.closest(selector);
    if (box instanceof HTMLElement && box !== input && isVisible(box, 40, 20)) return box;
  }

  // Relational fallback: the nearest ancestor that contains the input and a
  // likely send control. This survives class renames on sites without a
  // composer hint.
  let node: HTMLElement | null = input.parentElement;
  for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
    if (node === document.body) break;
    if (!isVisible(node, 40, 20)) continue;
    if (node.querySelector('button, [role="button"]')) {
      const rect = node.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      if (rect.width >= inputRect.width && rect.height >= inputRect.height) return node;
    }
  }
  return null;
}

export interface ComposerDock {
  box: HTMLElement;
  row: HTMLElement;
}

/**
 * A site without an explicit dock shape can still take the editor when its
 * composer is a vertical box and the editable lives in a row of its own. The
 * row must not carry the site's controls: hiding those would break the host.
 *
 * This is a shape check, not a promise. `mountDocked` measures the result and
 * falls back to the floating panel if the box does not actually grow.
 */
function genericComposerShape(input: HTMLElement): ComposerShape | null {
  const box = findComposerBox(input);
  if (!box) return null;
  // A custom element such as <rich-textarea> is the editing surface, not the
  // composer surface. Docking there would hide the wrong thing and borrow no
  // container styling; those sites need an adapter shape.
  if (box.tagName.includes('-') || box.matches('textarea, input, [contenteditable="true"]')) return null;

  const display = getComputedStyle(box).display;
  if (display === 'inline' || display === 'contents') return null;
  if (display.includes('flex')) {
    const style = getComputedStyle(box);
    const wraps = style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse';
    if (!style.flexDirection.startsWith('column') && !wraps) return null;
  }

  // ChatGPT wraps the editable in display:contents nodes. They have no box of
  // their own, so the row to hide is the outermost ancestor that actually
  // renders, and the path up to the box may pass through contents wrappers.
  let row: HTMLElement = input;
  let node: HTMLElement = input;
  while (node.parentElement && node.parentElement !== box) {
    node = node.parentElement;
    if (getComputedStyle(node).display !== 'contents') row = node;
  }
  let parent = row.parentElement;
  while (parent && parent !== box && getComputedStyle(parent).display === 'contents') {
    parent = parent.parentElement;
  }
  if (parent !== box || row === box) return null;

  for (const control of Array.from(
    row.querySelectorAll<HTMLElement>('button, [role="button"], input:not([type="hidden"]), select'),
  )) {
    if (control !== input && !input.contains(control) && isVisible(control, 4, 4)) return null;
  }

  const rect = row.getBoundingClientRect();
  if (rect.width < 60 || rect.height < 14) return null;
  // Append at the end of the box. Inserting between the text row and the
  // action bar can land in their explicit grid row and overlap it; the end is
  // an implicit new row on every grid/flex composer we support.
  return { box, row, dockable: true };
}

/** Docking is opt-in per adapter; a shape that does not fit falls back to floating. */
export function findComposerDock(input: HTMLElement): ComposerDock | null {
  const adapter = getActiveAdapter();
  if (!adapter.supportsDock) return null;
  const shape: ComposerShape | null = adapter.composer?.(input) ?? genericComposerShape(input);
  if (!shape?.dockable || !shape.row) return null;
  return { box: shape.box, row: shape.row };
}

/* ── action buttons ─────────────────────────────────────────────────────── */

function isDisabled(button: HTMLElement): boolean {
  return (
    (button as HTMLButtonElement).disabled ||
    button.getAttribute('aria-disabled') === 'true' ||
    button.hasAttribute('disabled')
  );
}

function scoreSendButton(button: HTMLElement, scope: HTMLElement | null): number {
  if (!isVisible(button, 4, 4)) return -1;
  const label = (button.getAttribute('aria-label') ?? '').trim();
  const testId = button.getAttribute('data-testid') ?? '';
  const title = button.getAttribute('title') ?? '';
  const className = button.className?.toString() ?? '';
  const icon = button.querySelector('mat-icon, .material-symbols-outlined, .google-symbols, svg');
  const iconText = (icon?.textContent ?? '').trim().toLowerCase();
  const ownText = (button.textContent ?? '').trim().toLowerCase();

  let value = 0;
  if (/^send(\s+message)?$/i.test(label) || /^submit$/i.test(label)) value += 100;
  else if (/^(send|submit)\b/i.test(label)) value += 60;
  else if (/send|submit/i.test(`${testId} ${title} ${className}`)) value += 40;
  if (iconText === 'send' || iconText === 'send_message' || iconText === 'arrow_upward') value += 50;
  else if (/^(send|submit)$/.test(ownText)) value += 35;
  if (button.getAttribute('type') === 'submit') value += 10;
  if (scope?.contains(button)) value += 15;
  if (button.closest('[aria-hidden="true"]')) value -= 40;
  return value;
}

function scopeFor(input: HTMLElement): HTMLElement | null {
  return findComposerBox(input) ?? input.closest('form') ?? null;
}

export function findSendButton(options: { includeDisabled?: boolean } = {}): HTMLElement | null {
  const adapter = getActiveAdapter();
  const input = findChatInput()?.element ?? null;
  const scope = input ? scopeFor(input) : null;

  const usable = (button: HTMLElement) =>
    isVisible(button, 4, 4) && (options.includeDisabled || !isDisabled(button));

  // 1. Explicit hints, preferring the same composer as the prompt box when
  // the page has more than one (a modal, a sidebar, a second conversation).
  for (const selector of adapter.sendSelectors) {
    let candidates: HTMLElement[];
    try {
      candidates = queryAll(selector);
    } catch {
      continue;
    }
    const ordered = scope
      ? [...candidates.filter((button) => scope.contains(button)), ...candidates]
      : candidates;
    for (const button of ordered) {
      if (!(button instanceof HTMLElement) || !usable(button)) continue;
      const inScope = !scope || scope.contains(button);
      const unlabelledSubmit = button.getAttribute('type') === 'submit' && inScope;
      if (isSendLike(button) || unlabelledSubmit) return button;
    }
  }

  // 2. Relational: score buttons inside the composer first, then the page.
  const inScope = scope
    ? Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"], [data-testid*="send" i]'))
    : [];
  const page = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], [data-testid*="send" i]'),
  );
  const candidates = [...new Set([...inScope, ...page])]
    .filter((button) => !isOurElement(button) && usable(button))
    .map((button) => ({ button, score: scoreSendButton(button, scope) }))
    .filter(
      (entry) =>
        entry.score >= 40 ||
        (entry.button.getAttribute('type') === 'submit' && Boolean(scope?.contains(entry.button))),
    )
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.button ?? null;
}

export function findAttachButton(): HTMLElement | null {
  const adapter = getActiveAdapter();
  const input = findChatInput()?.element ?? null;
  const scope = input ? scopeFor(input) : null;
  for (const selector of adapter.attachSelectors) {
    let candidates: HTMLElement[];
    try {
      candidates = queryAll(selector);
    } catch {
      continue;
    }
    const ordered = scope
      ? [...candidates.filter((button) => scope.contains(button)), ...candidates]
      : candidates;
    for (const button of ordered) {
      if (isVisible(button, 4, 4)) return button;
    }
  }
  return null;
}



/* ── text and responses ─────────────────────────────────────────────────── */

/** Current text of the prompt box, or '' when it cannot be read. */
export function readInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement) return input.value;
  return input.innerText ?? input.textContent ?? '';
}

/** Live text of the conversation, used to tell whether the response area rendered. */
export function findModelResponses(): HTMLElement[] {
  const selectors = ['model-response', '.model-response-text', 'message-content', '.response-content'];
  for (const selector of selectors) {
    const nodes = deepQueryAll(selector);
    if (nodes.length > 0) return nodes;
  }
  return [];
}
