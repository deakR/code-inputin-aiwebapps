/**
 * The panel: a shadow-DOM sidecar for an AI app's prompt box.
 *
 * Everything the host page can see is a small set of overlay hosts. All UI
 * lives inside shadow roots, all page-facing interactions go through `./dom`,
 * `./inject` and a small set of message handlers.
 *
 * Trusted Types note: the host page may enforce Trusted Types (Google
 * properties often do), so this module never assigns innerHTML — every node is
 * built with createElement / createElementNS.
 */

import type { EditorHandle } from '../composer/editor';
import { LANGUAGE_META, getLanguageMeta, guessLanguage } from '../composer/language-meta';
import { ext } from '../shared/ext';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  matchesShortcut,
  onSettingsChanged,
  saveSettings,
  type Settings,
} from '../shared/settings';
import type { SiteAdapter } from '../sites/types';
import {
  findAttachButton,
  findChatInput,
  findComposerBox,
  findComposerDock,
  findInputContainer,
  findSendButton,
  hasRepairDescriptor,
  loadRepairDescriptor,
  rememberFocusedComposer,
  setActiveAdapter,
  type ComposerDock,
  type InputMatch,
} from './dom';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { recordHealth, healthReport } from './health';
import {
  copyToClipboard,
  describeSendButton,
  insertIntoPromptBox,
  promptBoxContains,
  sendChatMessage,
} from './inject';
import { startPicker } from './picker';
import panelStyles from './panel.css';

/** Launcher chip: normally an inline child of the composer's action row. */
const LAUNCHER_HOST_ID = 'gci-root';
/** Toast: always a viewport-anchored overlay. */
const OVERLAY_HOST_ID = 'gci-overlay';
/** The panel: docked into the input box, or a floating overlay as fallback. */
const PANEL_HOST_ID = 'gci-inbox';
const SVG_NS = 'http://www.w3.org/2000/svg';
const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

/** Events from inside the shadow root are not allowed to reach the page. */
const BARRIER_EVENTS = [
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'paste',
  'cut',
  'copy',
  'drop',
  'dragover',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'contextmenu',
] as const;

let adapter: SiteAdapter = {
  id: 'generic',
  name: 'this page',
  editorKind: 'contenteditable',
  supportsDock: false,
  inputSelectors: [],
  sendSelectors: [],
  attachSelectors: [],
  composerSelectors: [],
  theme: { accent: '#1a73e8', accentDark: '#8ab4f8' },
  copy: { sent: 'Sent', insertHint: 'Insert into the prompt box' },
};
let settings: Settings = { ...DEFAULT_SETTINGS };
let overlayHost: HTMLElement | null = null;
let overlayShadow: ShadowRoot | null = null;
let launcherHost: HTMLElement | null = null;
let launcherShadow: ShadowRoot | null = null;
let panelHost: HTMLElement | null = null;
let panelShadow: ShadowRoot | null = null;
/** Set while the panel sits inside the host's input box. */
let dock: ComposerDock | null = null;
/** Set while an insert is running, when the dock is deliberately left alone. */
let inserting = false;
let launcher: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let editorArea: HTMLElement | null = null;
let toast: HTMLElement | null = null;
let langSelect: HTMLSelectElement | null = null;
let fenceToggle: HTMLInputElement | null = null;
let wrapToggle: HTMLInputElement | null = null;
let insertButton: HTMLButtonElement | null = null;
let sendButton: HTMLButtonElement | null = null;
let countLabel: HTMLElement | null = null;
let editor: EditorHandle | null = null;
let match: InputMatch | null = null;
let currentLanguageId = DEFAULT_SETTINGS.language;
let isOpen = false;
let lastInserted: string | null = null;
let panelBottom = 0;
let toastTimer: number | undefined;
let draftTimer: number | undefined;
let themeCheckedAt = 0;
let layoutQueued = false;
let lastStatusSelector = '';
let composerObserver: ResizeObserver | null = null;

/* ── small DOM helpers (Trusted-Types safe) ─────────────────────────────── */

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgIcon(...paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** The real event target, even when it sits inside an open shadow root. */
function composedTarget(event: Event): EventTarget | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
  const first = path?.[0];
  return first instanceof Node ? first : event.target;
}

function nextPaint(count = 1): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number) => {
      if (remaining <= 0) resolve();
      else requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

/* ── host elements ─────────────────────────────────────────────────────── */

/**
 * Host layout goes through CSSOM property setters: unlike a style attribute (or
 * cssText, which behaves like one) these are never blocked by a page's
 * Content-Security-Policy. The same values live in the stylesheet's :host rule,
 * so a stricter host page still can't disturb the layout.
 *
 * Three hosts on purpose. The launcher should live in the composer's own
 * action row; the toast has to stay anchored to the viewport; the panel moves
 * between the composer and the overlay.
 */
const HOST_PROPS = [
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'z-index',
  'grid-column',
  'pointer-events',
  'display',
  'flex',
  'align-items',
  'justify-content',
  'vertical-align',
  'margin',
  'padding',
  'transform',
] as const;

function applyHostStyles(node: HTMLElement, mode: 'overlay' | 'docked' | 'inline' | 'floating'): void {
  const style = node.style;
  for (const property of HOST_PROPS) style.removeProperty(property);
  node.classList.remove('gci-inline', 'gci-floating');

  if (mode === 'overlay') {
    style.setProperty('pointer-events', 'none', 'important');
    style.setProperty('position', 'fixed', 'important');
    style.setProperty('inset', '0', 'important');
    style.setProperty('z-index', '2147483647', 'important');
    return;
  }

  if (mode === 'docked') {
    // Docked: part of the host's own flow, as a full-width row of the input
    // box's grid, sized by the panel inside it.
    style.setProperty('pointer-events', 'none', 'important');
    style.setProperty('position', 'relative', 'important');
    style.setProperty('width', '100%', 'important');
    style.setProperty('height', 'auto', 'important');
    style.setProperty('grid-column', '1 / -1', 'important');
    return;
  }

  if (mode === 'inline') {
    // The browser lays this host out as a flex item of the composer actions.
    // No coordinates, no chase loop, no slide animation.
    node.classList.add('gci-inline');
    style.setProperty('pointer-events', 'auto', 'important');
    style.setProperty('position', 'static', 'important');
    style.setProperty('display', 'inline-flex', 'important');
    style.setProperty('align-items', 'center', 'important');
    style.setProperty('justify-content', 'center', 'important');
    style.setProperty('vertical-align', 'middle', 'important');
    style.setProperty('width', '30px', 'important');
    style.setProperty('height', '30px', 'important');
    style.setProperty('flex', '0 0 auto', 'important');
    style.setProperty('margin', '0', 'important');
    style.setProperty('padding', '0', 'important');
    style.setProperty('z-index', 'auto', 'important');
    return;
  }

  // Floating fallback: one deterministic viewport corner, no chasing. `inset`
  // from the stylesheet's :host rule must be cleared or left/top win over
  // right/bottom and the chip parks at 0,0.
  node.classList.add('gci-floating');
  style.setProperty('pointer-events', 'auto', 'important');
  style.setProperty('position', 'fixed', 'important');
  style.setProperty('inset', 'auto', 'important');
  style.setProperty('top', 'auto', 'important');
  style.setProperty('left', 'auto', 'important');
  style.setProperty('display', 'inline-flex', 'important');
  style.setProperty('align-items', 'center', 'important');
  style.setProperty('justify-content', 'center', 'important');
  style.setProperty('right', '20px', 'important');
  style.setProperty('bottom', '20px', 'important');
  style.setProperty('width', '30px', 'important');
  style.setProperty('height', '30px', 'important');
  style.setProperty('z-index', '2147483647', 'important');
}

/**
 * The page's own UI font. `all: initial` in the stylesheet cuts inheritance at
 * the shadow boundary, so the family has to be handed across explicitly.
 */
function pageUiFont(): string | null {
  try {
    const family = getComputedStyle(document.body).fontFamily;
    if (family && !family.includes('Times New Roman') && !/(^|[^a-z])serif\b/i.test(family)) {
      return family;
    }
  } catch {
    /* fallback to stylesheet */
  }
  return null;
}

function createShadowHost(id: string): { host: HTMLElement; shadow: ShadowRoot } {
  const node = element('div');
  node.id = id;
  installEventBarrier(node);
  const font = pageUiFont();
  if (font) node.style.setProperty('--gci-ui-font', font);

  const root = node.attachShadow({ mode: 'open' });

  // Prefer constructable stylesheets: they are pure CSSOM, so a strict page
  // CSP has nothing to complain about.
  let applied = false;
  if ('adoptedStyleSheets' in root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(panelStyles);
      root.adoptedStyleSheets = [sheet];
      applied = true;
    } catch {
      applied = false;
    }
  }
  if (!applied) {
    const style = element('style');
    style.textContent = panelStyles;
    root.appendChild(style);
  }

  return { host: node, shadow: root };
}

function ensureOverlayHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (!overlayHost || !overlayShadow) {
    const created = createShadowHost(OVERLAY_HOST_ID);
    overlayHost = created.host;
    overlayShadow = created.shadow;
    applyHostStyles(overlayHost, 'overlay');
    (document.body ?? document.documentElement).appendChild(overlayHost);
  }
  return { host: overlayHost, shadow: overlayShadow };
}

function ensureLauncherHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (!launcherHost || !launcherShadow) {
    const created = createShadowHost(LAUNCHER_HOST_ID);
    launcherHost = created.host;
    launcherShadow = created.shadow;
  }
  return { host: launcherHost, shadow: launcherShadow };
}

function ensurePanelHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (!panelHost || !panelShadow) {
    const created = createShadowHost(PANEL_HOST_ID);
    panelHost = created.host;
    panelShadow = created.shadow;
    applyHostStyles(panelHost, 'overlay');
    (document.body ?? document.documentElement).appendChild(panelHost);
  }
  return { host: panelHost, shadow: panelShadow };
}

/** Stops UI events from escaping into the host page's own handlers. */
function installEventBarrier(node: HTMLElement): void {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of BARRIER_EVENTS) node.addEventListener(type, stop, false);
}

function formatShortcutLabel(shortcut: string): string {
  if (!shortcut) return '';
  if (!IS_MAC) return shortcut;
  return shortcut
    .replace(/Ctrl|Control|Cmd|Command|Mod/gi, '⌘')
    .replace(/Alt|Option/gi, '⌥')
    .replace(/Shift/gi, '⇧')
    .replace(/\+/g, '');
}

function updateLauncherTitle(): void {
  if (!launcher) return;
  const shortcut = settings.shortcut || DEFAULT_SETTINGS.shortcut;
  const display = formatShortcutLabel(shortcut);
  const label = display ? `Code editor (${display})` : 'Code editor';
  launcher.title = label;
  launcher.setAttribute('aria-label', label);
}

/** The adapter's accent, applied to both the chip and the panel. */
function applyAdapterTheme(): void {
  for (const node of [launcher, panel]) {
    if (!node) continue;
    node.style.setProperty('--gci-accent-light', adapter.theme.accent);
    node.style.setProperty('--gci-accent-dark', adapter.theme.accentDark);
  }
}

function buildLauncher(root: ShadowRoot): void {
  if (launcher) return;
  const button = element('button', 'gci-launcher');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  // Icon-only chip: the wording lives in the tooltip and the accessible name.
  button.appendChild(svgIcon('M10 6 L4 12 L10 18', 'M14 6 L20 12 L14 18'));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });
  root.appendChild(button);
  launcher = button;
  updateLauncherTitle();
  applyAdapterTheme();
}

type LauncherEdge = 'start' | 'end';

interface LauncherSlotCandidate {
  container: HTMLElement;
  edge: LauncherEdge;
  score: number;
  source: string;
}

interface LauncherPlacement {
  /** The composer box, not the editable: the textarea can be replaced while the composer stays. */
  composer: HTMLElement;
  mode: 'inline' | 'floating';
  container: HTMLElement | null;
  /**
   * The end of the row the chip owns. Rows are laid out against one edge of the
   * composer; pinning the chip to that same edge means host controls that come
   * and go at the other end (Gemini's mic/send swap, ChatGPT's accessory) can
   * never drag it sideways.
   */
  edge: LauncherEdge;
}

let launcherPlacement: LauncherPlacement | null = null;
let launcherRetryTimer: number | undefined;
/** When the locked row stopped being visible, so a real layout change can win. */
let launcherHiddenSince = 0;
let floatingRecoveryTimer: number | undefined;
/** One automatic "is there an inline row now?" probe after a fallback. */
let floatingRecoveryDone = false;

/**
 * A page menu or tooltip can cover the chip for a second without the chip's
 * row having changed. Keep the placement and retry instead of moving the chip
 * to another side, which is what made it appear to "jump" on ChatGPT.
 */
function scheduleLauncherRetry(delay = 500): void {
  if (launcherRetryTimer) return;
  launcherRetryTimer = window.setTimeout(() => {
    launcherRetryTimer = undefined;
    mountLauncher();
  }, delay);
}

function composerFor(input: HTMLElement): HTMLElement {
  return findComposerBox(input) ?? findInputContainer(input);
}

function isOurNode(node: Element | null): boolean {
  return Boolean(node && (node === launcherHost || node.id.startsWith('gci-')));
}

/** Visible children the host page owns. Our chip is not part of the row's geometry. */
function rowChildren(container: HTMLElement): Element[] {
  return Array.from(container.children).filter(
    (child) => !isOurNode(child) && child.getClientRects().length > 0,
  );
}

/**
 * The end of a row that is anchored to the composer. A right-aligned action row
 * has empty space on its left and none on its right; a left-aligned row is the
 * mirror image. Placing the chip on the anchored side keeps it still while
 * buttons grow the row away from that edge. Ties fall back to which half of the
 * composer the row occupies.
 */
function stableEdge(container: HTMLElement, composer: HTMLElement): LauncherEdge {
  const style = getComputedStyle(container);
  const horizontal = !style.display.includes('flex') || style.flexDirection.startsWith('row');
  const children = rowChildren(container);
  const rect = container.getBoundingClientRect();

  if (horizontal && children.length > 0) {
    const first = children[0].getBoundingClientRect();
    const last = children[children.length - 1].getBoundingClientRect();
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const leftGap = first.left - rect.left - padLeft;
    const rightGap = rect.right - padRight - last.right;
    if (leftGap > rightGap + 8) return 'end';
    if (rightGap > leftGap + 8) return 'start';
  }

  const box = composer.getBoundingClientRect();
  return rect.left + rect.width / 2 >= box.left + box.width / 2 ? 'end' : 'start';
}

/** Put the chip at its stable end, in flow, with the browser doing the layout. */
function insertAtEdge(host: HTMLElement, container: HTMLElement, edge: LauncherEdge): void {
  if (edge === 'end') {
    container.appendChild(host);
    return;
  }
  container.insertBefore(host, rowChildren(container)[0] ?? null);
}

function isAtEdge(host: HTMLElement, container: HTMLElement, edge: LauncherEdge): boolean {
  if (host.parentElement !== container) return false;
  let sibling = edge === 'start' ? host.previousElementSibling : host.nextElementSibling;
  while (sibling) {
    // A hidden anchor/sentinel at the end of the row does not count as a control
    // the chip must stay ahead of.
    if (!isOurNode(sibling) && sibling.getClientRects().length > 0) return false;
    sibling = edge === 'start' ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
  return true;
}

function isPotentialSlot(
  container: HTMLElement | null,
  input: HTMLElement,
  composer: HTMLElement,
): container is HTMLElement {
  if (!container || !container.isConnected) return false;
  if (container === input || container.contains(input)) return false;
  if (container === document.body || container === document.documentElement) return false;
  if (container.closest('#gci-root, #gci-inbox, #gci-overlay, #gci-picker')) return false;
  const root = container.getRootNode();
  if (root instanceof ShadowRoot && /^gci-/.test(root.host?.id ?? '')) return false;
  if (container.matches('button, [role="button"]') || container.tagName.includes('-')) {
    return false;
  }
  const label = `${container.getAttribute('data-slot') ?? ''} ${container.className?.toString() ?? ''}`.toLowerCase();
  if (/accessory|overlay|backdrop|tooltip|popover|dropdown-menu/.test(label)) return false;

  const rect = container.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 12) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;

  const style = getComputedStyle(container);
  if (style.display === 'contents' || style.visibility === 'hidden') return false;
  if (style.pointerEvents === 'none') return false;

  // Keep candidate rows in the composer's neighbourhood, even when the page
  // has sidebars with their own action buttons.
  if (container !== composer && !composer.contains(container)) {
    const composerRect = composer.getBoundingClientRect();
    if (
      rect.bottom < composerRect.top - 140 ||
      rect.top > composerRect.bottom + 140
    ) {
      return false;
    }
  }
  return true;
}

function addSlotCandidate(
  candidates: Map<HTMLElement, LauncherSlotCandidate>,
  container: HTMLElement | null,
  input: HTMLElement,
  composer: HTMLElement,
  score: number,
  source: string,
  edge?: LauncherEdge,
): void {
  if (!isPotentialSlot(container, input, composer)) return;
  const current = candidates.get(container);
  if (current && current.score >= score) return;
  candidates.set(container, {
    container,
    edge: edge ?? stableEdge(container, composer),
    score,
    source,
  });
}

/**
 * Find every plausible action row around the composer, best first:
 *   adapter hint → labelled trailing/action row → send row → attach row →
 *   any compact row containing buttons.
 *
 * Candidates are validated by an actual hit test in `mountLauncher`; a row
 * that is covered by a page overlay is rejected and the next one is tried.
 */
function collectLauncherCandidates(input: HTMLElement): LauncherSlotCandidate[] {
  const composer = composerFor(input);
  const candidates = new Map<HTMLElement, LauncherSlotCandidate>();

  const custom = adapter.launcherSlot?.(input);
  if (custom) {
    addSlotCandidate(candidates, custom.container, input, composer, 120, 'adapter', custom.edge);
  }

  const send = findSendButton({ includeDisabled: true });
  if (send) {
    let node: HTMLElement | null = send.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      addSlotCandidate(candidates, node, input, composer, 85 - depth * 8, 'send');
    }
  }

  const attach = findAttachButton();
  if (attach) {
    let node: HTMLElement | null = attach.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      addSlotCandidate(candidates, node, input, composer, 60 - depth * 7, 'attach');
    }
  }

  for (const selector of [
    '[data-slot*="trailing" i]',
    '[data-slot*="action" i]',
    '[class*="trailing-actions" i]',
    '[class*="composer-actions" i]',
    '[class*="input-buttons" i]',
    '[class*="action-row" i]',
  ]) {
    for (const node of composer.querySelectorAll<HTMLElement>(selector)) {
      addSlotCandidate(candidates, node, input, composer, 75, 'labelled-row');
    }
  }

  // Last structural fallback: compact rows inside the composer that contain
  // controls. The hit test still has the final say.
  const descendants = Array.from(composer.querySelectorAll<HTMLElement>('div, section')).slice(0, 120);
  for (const node of descendants) {
    if (!node.querySelector('button, [role="button"], input[type="submit"]')) continue;
    const rect = node.getBoundingClientRect();
    if (rect.height > 64 || rect.width < 60) continue;
    addSlotCandidate(candidates, node, input, composer, 35, 'button-row');
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

/** True when the visible pixel at the chip's centre belongs to the chip. */
function isHostHit(hit: Element | null, host: HTMLElement): boolean {
  if (!hit) return false;
  if (hit === host || host.contains(hit)) return true;
  const root = hit.getRootNode();
  return root instanceof ShadowRoot && root.host === host;
}

/** `elementFromPoint` stops at the outer shadow host; drill into open roots. */
function deepElementFromPoint(x: number, y: number): Element | null {
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
}

function hostIsClickable(host: HTMLElement): boolean {
  const rect = host.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  return isHostHit(deepElementFromPoint(x, y), host);
}

/**
 * Try one row for real: insert the chip, force layout, and hit-test its centre.
 * A covered candidate is removed and the next one is tried. This is the check
 * that catches ChatGPT's `composer-accessory` overlay, which is invisible to
 * selector-based logic and swallowed clicks on the left-hand attach row.
 *
 * This runs only when a row is first chosen. A locked placement is never
 * re-tested, so a tooltip or ripple cannot evict it later.
 */
function insertHostInSlot(
  host: HTMLElement,
  container: HTMLElement,
  edge: LauncherEdge,
  composer: HTMLElement,
): boolean {
  try {
    applyHostStyles(host, 'inline');
    host.style.setProperty('opacity', '0', 'important');
    insertAtEdge(host, container, edge);

    const hostRect = host.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const slack = 4;
    const outsideRow =
      hostRect.width < 8 ||
      hostRect.height < 8 ||
      hostRect.left < containerRect.left - slack ||
      hostRect.right > containerRect.right + slack ||
      hostRect.top < containerRect.top - slack ||
      hostRect.bottom > containerRect.bottom + slack;
    // A tight row may legitimately hug the chip; what matters is that the chip
    // is still inside the composer and is the element receiving its own clicks.
    const outsideComposer =
      hostRect.left < composerRect.left - 12 ||
      hostRect.right > composerRect.right + 12 ||
      hostRect.top < composerRect.top - 160 ||
      hostRect.bottom > composerRect.bottom + 160;

    if (outsideRow || outsideComposer || !hostIsClickable(host)) {
      host.remove();
      return false;
    }

    host.style.setProperty('opacity', '1', 'important');
    return true;
  } catch {
    host.remove();
    return false;
  }
}

/**
 * The floating fallback is one deterministic corner and never chases overlays.
 * Probing four corners used to make the chip hop to another corner whenever a
 * page toast happened to cover the previous one.
 */
function placeFloating(host: HTMLElement): void {
  applyHostStyles(host, 'floating');
  host.style.setProperty('opacity', '1', 'important');
  if (host.parentElement !== document.body) {
    (document.body ?? document.documentElement).appendChild(host);
  }
}

function sameComposer(a: HTMLElement, b: HTMLElement): boolean {
  return a === b || a.contains(b) || b.contains(a);
}

/**
 * A composer can be mid-animation when the first placement is attempted, which
 * sends the chip to the corner even though the action row becomes usable a
 * moment later. Probe inline once more; if there is still no row, stay put.
 */
function scheduleFloatingRecovery(): void {
  if (floatingRecoveryDone) return;
  floatingRecoveryDone = true;
  floatingRecoveryTimer = window.setTimeout(() => {
    floatingRecoveryTimer = undefined;
    if (isOpen || launcherPlacement?.mode !== 'floating') return;
    launcherPlacement = null;
    mountLauncher();
  }, 1200);
}

function cancelFloatingRecovery(): void {
  if (!floatingRecoveryTimer) return;
  window.clearTimeout(floatingRecoveryTimer);
  floatingRecoveryTimer = undefined;
}

/** Where the chip should live: a locked composer action row, or a clear corner. */
function mountLauncher(): void {
  const { host } = ensureLauncherHost();
  if (!launcherHost) return;

  const shouldShow = Boolean(match) && settings.showLauncher && !isOpen;
  if (!shouldShow) {
    host.remove();
    launcherPlacement = null;
    launcherHiddenSince = 0;
    if (launcher) launcher.hidden = true;
    return;
  }

  if (!match) {
    host.remove();
    launcherPlacement = null;
    return;
  }

  if (launcher) launcher.hidden = false;
  const input = match.element;
  const composer = composerFor(input);

  // A rebuilt box often contains the old one (or vice versa). Only a genuinely
  // different composer invalidates the row and its stable edge.
  if (launcherPlacement && !sameComposer(launcherPlacement.composer, composer)) {
    launcherPlacement = null;
    launcherHiddenSince = 0;
    floatingRecoveryDone = false;
  }

  if (settings.launcherMode === 'floating') {
    if (launcherPlacement?.mode !== 'floating' || host.parentElement !== document.body) {
      placeFloating(host);
    }
    launcherPlacement = { composer, mode: 'floating', container: null, edge: 'end' };
    return;
  }

  // Keep a verified placement. The browser already keeps an inline chip glued to
  // its row; re-running candidate scoring on every mutation is what let a
  // transient overlay or a half-rendered row move the chip to the other side.
  if (launcherPlacement?.mode === 'inline' && launcherPlacement.container) {
    const { container, edge } = launcherPlacement;
    if (!container.isConnected) {
      launcherPlacement = null;
      launcherHiddenSince = 0;
    } else if (container.getClientRects().length === 0) {
      // The site hides the row while a menu is open or the composer collapses.
      // Stay with it for a beat; only a lasting hide counts as a real change.
      if (!launcherHiddenSince) launcherHiddenSince = Date.now();
      if (Date.now() - launcherHiddenSince < 2000) {
        scheduleLauncherRetry();
        return;
      }
      launcherPlacement = null;
      launcherHiddenSince = 0;
    } else {
      launcherHiddenSince = 0;
      // Host controls are added and removed around the chip. Put it back on the
      // same stable edge instead of re-scoring; this is the only move allowed.
      if (host.parentElement !== container || !isAtEdge(host, container, edge)) {
        insertAtEdge(host, container, edge);
      }
      launcherPlacement.composer = composer;
      return;
    }
  } else if (launcherPlacement?.mode === 'floating') {
    if (host.parentElement === document.body) return;
    placeFloating(host);
    return;
  }

  for (const candidate of collectLauncherCandidates(input)) {
    if (!insertHostInSlot(host, candidate.container, candidate.edge, composer)) continue;
    launcherPlacement = {
      composer,
      mode: 'inline',
      container: candidate.container,
      edge: candidate.edge,
    };
    launcherHiddenSince = 0;
    floatingRecoveryDone = false;
    cancelFloatingRecovery();
    recordHealth('launcher', `inline:${candidate.source}`, true);
    return;
  }

  placeFloating(host);
  launcherPlacement = { composer, mode: 'floating', container: null, edge: 'end' };
  recordHealth('launcher', 'floating', false);
  scheduleFloatingRecovery();
}

function updateLauncherVisibility(): void {
  mountLauncher();
}

/* ── panel ─────────────────────────────────────────────────────────────── */

function toggleRow(labelText: string): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = element('label', 'gci-toggle');
  const input = element('input');
  input.type = 'checkbox';
  row.appendChild(input);
  row.appendChild(element('span', undefined, labelText));
  return { row, input };
}

function buildPanel(root: ShadowRoot): void {
  if (panel) return;

  const container = element('div', 'gci-panel');
  container.hidden = true;
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-label', 'Code editor');

  const resize = element('div', 'gci-resize');
  resize.title = 'Drag to resize';
  resize.addEventListener('pointerdown', startResize);
  container.appendChild(resize);

  // header
  const header = element('div', 'gci-header');
  header.appendChild(element('span', 'gci-title', 'Code'));

  const select = element('select', 'gci-select');
  select.title = 'Syntax highlighting language';
  for (const language of LANGUAGE_META) {
    const option = element('option', undefined, language.label);
    option.value = language.id;
    select.appendChild(option);
  }
  select.addEventListener('change', () => setLanguage(select.value, true));
  header.appendChild(select);
  langSelect = select;

  const fence = toggleRow('fence');
  fence.input.title = 'Wrap the code in a ``` fenced block';
  fence.input.addEventListener('change', () => setFence(fence.input.checked));
  header.appendChild(fence.row);
  fenceToggle = fence.input;

  const wrap = toggleRow('wrap');
  wrap.input.title = 'Wrap long lines';
  wrap.input.addEventListener('change', () => setWrapLines(wrap.input.checked));
  header.appendChild(wrap.row);
  wrapToggle = wrap.input;

  // The line/char counter rides along with the controls so that the docked strip
  // keeps it after the floating panel's footer is hidden.
  countLabel = element('span', 'gci-count', '0 lines');
  header.appendChild(countLabel);

  header.appendChild(element('div', 'gci-spacer'));

  const send = element('button', 'gci-btn', 'Send');
  send.type = 'button';
  send.title = `Insert and press ${adapter.name}’s send button`;
  send.addEventListener('click', () => void doInsert('send'));
  header.appendChild(send);
  sendButton = send;

  const insert = element('button', 'gci-btn gci-btn-primary', 'Insert');
  insert.type = 'button';
  insert.title = `Insert into the prompt box (${MOD_KEY}+Enter)`;
  insert.addEventListener('click', () => void doInsert('insert'));
  header.appendChild(insert);
  insertButton = insert;

  const close = element('button', 'gci-icon-btn');
  close.type = 'button';
  close.title = 'Close (Esc)';
  close.appendChild(svgIcon('M6 6 L18 18', 'M18 6 L6 18'));
  close.addEventListener('click', () => closePanel());
  header.appendChild(close);

  container.appendChild(header);

  // editor host
  const area = element('div', 'gci-editor');
  container.appendChild(area);
  editorArea = area;

  // footer
  const footer = element('div', 'gci-footer');
  const hints = element('div', 'gci-hint');
  for (const [key, label] of [
    ['Tab', 'indent'],
    [`${MOD_KEY}+/`, 'comment'],
    [`${MOD_KEY}+Enter`, 'insert'],
    ['Esc', 'close'],
  ] as const) {
    const hint = element('span');
    hint.appendChild(element('span', 'gci-key', key));
    hint.appendChild(document.createTextNode(` ${label}`));
    hints.appendChild(hint);
  }
  footer.appendChild(hints);
  container.appendChild(footer);

  container.addEventListener('paste', onEditorPaste, true);

  root.appendChild(container);
  panel = container;
  applyAdapterTheme();
}

/* ── editor loading ────────────────────────────────────────────────────── */

type EditorModule = typeof import('../composer/editor');

let editorModulePromise: Promise<EditorModule> | null = null;

/**
 * CodeMirror lives in `dist/composer.js` (with one chunk per language under
 * `dist/composer/`) and is imported on first use, so an ordinary page load
 * never pays for any of it.
 */
function loadEditorModule(): Promise<EditorModule> {
  if (!editorModulePromise) {
    const url = ext.runtime.getURL('composer.js');
    editorModulePromise = import(url) as Promise<EditorModule>;
    editorModulePromise.catch(() => {
      editorModulePromise = null;
    });
  }
  return editorModulePromise;
}

let editorPromise: Promise<void> | null = null;

/**
 * Builds the editor on first use. Two awaits (the CodeMirror chunk, then the
 * selected language chunk) mean a second caller could slip in between, so the
 * work lives in one shared promise and the host element is re-checked after.
 */
function ensureEditor(): Promise<void> {
  if (editor || !editorArea) return Promise.resolve();
  editorPromise ??= (async () => {
    const area = editorArea;
    if (!area) return;
    const module = await loadEditorModule();
    const language = await module.loadLanguage(currentLanguageId);
    if (editor || editorArea !== area) return;
    area.textContent = '';
    editor = module.createEditor({
      parent: area,
      language,
      wrapLines: settings.wrapLines,
      dark: isPageDark(),
      cspNonce: readCspNonce(),
      placeholderText: 'Paste or type code…',
      onChange: () => {
        updateInsertState();
        scheduleDraftSave();
      },
      onInsert: () => void doInsert('insert'),
    });
    updateInsertState();
    await restoreDraft();
  })().finally(() => {
    editorPromise = null;
  });
  return editorPromise;
}

/** Shows the panel immediately, then brings the editor in when it has loaded. */
async function activateEditor(): Promise<void> {
  if (!editor && editorArea) editorArea.textContent = 'Loading editor…';
  try {
    await ensureEditor();
  } catch (error) {
    console.error('[gci] could not load the editor chunk', error);
    recordHealth('editor-load', String(error), false);
    if (editorArea) editorArea.textContent = 'Could not load the code editor.';
    showToast('Could not load the code editor — see the console for details', 'error');
    return;
  }
  if (isOpen) layoutPanel();
  await nextPaint();
  editor?.focus();
}

/** Some pages (Google's, for one) hand out a nonce the editor's styles can reuse. */
function readCspNonce(): string {
  try {
    const script = document.querySelector('script[nonce]');
    return (script as HTMLScriptElement | null)?.nonce ?? '';
  } catch {
    return '';
  }
}

function layoutPanel(): void {
  if (!panel || panel.hidden || dock) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const narrow = viewportWidth < 640;
  const gap = 8;

  let height: number;
  let bottom: number;
  let width: number;
  let right: number;

  const container = match
    ? findComposerBox(match.element) ?? findInputContainer(match.element)
    : null;
  const rect = container?.getBoundingClientRect();

  if (narrow) {
    width = viewportWidth - gap * 2;
    right = gap;
    bottom = gap;
    height = Math.round(Math.min(settings.panelHeight, viewportHeight * 0.6));
  } else if (rect && rect.top > 120) {
    width = Math.round(clamp(settings.panelWidth, 320, viewportWidth - gap * 2));
    right = clamp(viewportWidth - rect.right, gap, viewportWidth - width - gap);
    bottom = clamp(viewportHeight - rect.top + gap, gap, viewportHeight - 160);
    height = Math.round(clamp(settings.panelHeight, 160, viewportHeight - bottom - gap));
  } else {
    width = Math.round(clamp(settings.panelWidth, 320, viewportWidth - gap * 2));
    right = gap * 2;
    bottom = gap * 2;
    height = Math.round(clamp(settings.panelHeight, 160, viewportHeight - 40));
  }

  panelBottom = bottom;
  panel.style.right = `${Math.round(right)}px`;
  panel.style.left = 'auto';
  panel.style.bottom = `${Math.round(bottom)}px`;
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
}

/**
 * Docked, the panel grows with the code (see `.gci-docked` in panel.css) and the
 * height setting becomes the cap at which the editor starts scrolling — a small
 * snippet gets a small box, like the host's own composer. Floating, the setting
 * is the panel height.
 */
function applyPanelHeight(): void {
  if (!panel) return;
  const ceiling = Math.max(200, Math.round(window.innerHeight * 0.7));
  const preferred = Math.round(clamp(settings.panelHeight, 180, ceiling));
  if (dock) {
    panel.style.removeProperty('height');
    panel.style.setProperty('--gci-dock-max', `${preferred}px`);
    return;
  }
  panel.style.height = `${preferred}px`;
  panel.style.removeProperty('width');
}

function startResize(event: PointerEvent): void {
  if (!panel) return;
  // Docked, the panel follows its content: the handle is hidden (see
  // .gci-docked .gci-resize), and the setting caps the height instead.
  if (dock) return;
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = panel.getBoundingClientRect().height;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const maxHeight = window.innerHeight - panelBottom - 8;

  const onMove = (move: PointerEvent) => {
    if (!panel) return;
    const next = Math.round(clamp(startHeight + (startY - move.clientY), 160, maxHeight));
    settings.panelHeight = next;
    panel.style.height = `${next}px`;
  };
  const onUp = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    void saveSettings({ panelHeight: settings.panelHeight });
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

/* ── theme ─────────────────────────────────────────────────────────────── */

function parseColor(value: string): [number, number, number, number] | null {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/i.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function isPageDark(): boolean {
  const input = match?.element;
  const box = input ? findComposerBox(input) ?? findInputContainer(input) : null;
  for (const node of [box, document.body, document.documentElement]) {
    if (!node) continue;
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (!color || color[3] < 0.5) continue;
    const luminance = (0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]) / 255;
    return luminance < 0.5;
  }
  const root = document.documentElement;
  const body = document.body;
  if (root?.classList.contains('dark-theme') || body?.classList.contains('dark-theme')) return true;
  if (root?.getAttribute('data-theme') === 'dark' || body?.getAttribute('data-theme') === 'dark') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function updateTheme(force = false): void {
  const now = Date.now();
  if (!force && now - themeCheckedAt < 2000) return;
  themeCheckedAt = now;
  const dark = isPageDark();
  launcher?.classList.toggle('gci-dark', dark);
  panel?.classList.toggle('gci-dark', dark);
  toast?.classList.toggle('gci-dark', dark);
  editor?.setDark(dark);
}

/* ── open / close ──────────────────────────────────────────────────────── */

/**
 * Docks the panel into the host's input box: the host becomes a full-width row
 * of the box's grid, the site's own text row steps aside, and the box grows to
 * hold the editor.
 */
function mountDocked(target: ComposerDock): void {
  const { host: node, shadow: root } = ensurePanelHost();
  buildPanel(root);
  if (!panel) return;

  // Moving to another box (the host rebuilt the composer): give the old row back.
  if (dock && dock.row !== target.row) showComposerRow();
  if (node.parentElement !== target.box) target.box.appendChild(node);
  applyHostStyles(node, 'docked');
  hideComposerRow(target);
  panel.classList.add('gci-docked');
  // The floating layout's coordinates mean nothing inside the box.
  panel.style.removeProperty('left');
  panel.style.removeProperty('right');
  panel.style.removeProperty('bottom');
  panel.style.removeProperty('width');
  dock = target;
  applyPanelHeight();
}

/** The fallback: a floating panel over the page, anchored above the prompt box. */
function mountFloating(): void {
  const { host: node, shadow: root } = ensurePanelHost();
  buildPanel(root);
  if (!panel) return;

  if (node.parentElement !== document.body) {
    (document.body ?? document.documentElement).appendChild(node);
  }
  applyHostStyles(node, 'overlay');
  panel.classList.remove('gci-docked');
  dock = null;
  layoutPanel();
}

/** The site's own text row steps aside while the editor holds its place. */
function hideComposerRow(target: ComposerDock): void {
  target.row.style.setProperty('display', 'none', 'important');
}

/** …and comes back for the insert, which needs the real prompt box rendered. */
function showComposerRow(): void {
  if (dock && dock.row.isConnected) dock.row.style.removeProperty('display');
}

/**
 * Hands the box back to the site: the text row returns (the insert path needs
 * the real prompt box rendered) and the panel host goes back to the body overlay.
 */
function releaseDock(): void {
  showComposerRow();
  dock = null;
  if (panel) panel.classList.remove('gci-docked');
  if (!panelHost) return;
  if (panelHost.parentElement !== document.body) {
    (document.body ?? document.documentElement).appendChild(panelHost);
  }
  applyHostStyles(panelHost, 'overlay');
}

function openPanel(): void {
  const { shadow: root } = ensurePanelHost();
  buildPanel(root);
  refreshMatch();
  if (!panel) return;

  panel.hidden = false;
  isOpen = true;
  if (launcher) launcher.setAttribute('aria-expanded', 'true');
  updateLauncherVisibility();

  syncControls();
  updateTheme(true);

  const target = match ? findComposerDock(match.element) : null;
  if (target) mountDocked(target);
  else mountFloating();

  updateInsertState();
  recordHealth('open', match?.selector ?? 'no match', Boolean(match));
  void activateEditor();
}

function closePanel(focusPromptBox = true): void {
  releaseDock();
  // Drop any autocomplete popup with the panel: CodeMirror remembers the
  // completion state and would show it again the moment the view is refocused.
  editor?.closeCompletion();
  if (panel) panel.hidden = true;
  isOpen = false;
  if (launcher) launcher.setAttribute('aria-expanded', 'false');
  updateLauncherVisibility();
  if (focusPromptBox) refreshMatch()?.element.focus();
  recordHealth('close', match?.selector ?? 'no match', true);
}

function togglePanel(): void {
  if (isOpen) closePanel();
  else openPanel();
}

/* ── settings plumbing ─────────────────────────────────────────────────── */

function syncControls(): void {
  if (langSelect) langSelect.value = currentLanguageId;
  if (fenceToggle) fenceToggle.checked = settings.wrapInFence;
  if (wrapToggle) wrapToggle.checked = settings.wrapLines;
  markToggle(fenceToggle, settings.wrapInFence);
  markToggle(wrapToggle, settings.wrapLines);
}

/**
 * Mirrors a toggle's state onto its label, so the docked strip can style it as a
 * chip (where the checkbox itself is hidden) without reading the input.
 */
function markToggle(input: HTMLInputElement | null, on: boolean): void {
  const row = input?.closest('.gci-toggle');
  if (row instanceof HTMLElement) row.dataset.on = String(on);
}

function setLanguage(id: string, persist: boolean): void {
  currentLanguageId = id;
  if (langSelect) langSelect.value = id;
  void applyLanguage(id);
  updateInsertState();
  if (persist) void saveSettings({ language: id });
}

/** Language packages load on demand; the last selection wins. */
let languageRequest = 0;

async function applyLanguage(id: string): Promise<void> {
  const request = ++languageRequest;
  try {
    const module = await loadEditorModule();
    const language = await module.loadLanguage(id);
    if (request === languageRequest) editor?.setLanguage(language);
  } catch (error) {
    console.error('[gci] could not load the language package', error);
  }
}

function setFence(enabled: boolean): void {
  settings.wrapInFence = enabled;
  if (fenceToggle) fenceToggle.checked = enabled;
  markToggle(fenceToggle, enabled);
  updateInsertState();
  void saveSettings({ wrapInFence: enabled });
}

function setWrapLines(enabled: boolean): void {
  settings.wrapLines = enabled;
  if (wrapToggle) wrapToggle.checked = enabled;
  markToggle(wrapToggle, enabled);
  editor?.setWrap(enabled);
  void saveSettings({ wrapLines: enabled });
}

/* ── drafts ────────────────────────────────────────────────────────────── */

function scheduleDraftSave(): void {
  if (draftTimer) window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    draftTimer = undefined;
    if (editor) void saveDraft(editor.getText(), currentLanguageId);
  }, 600);
}

/** Write immediately when the tab is hidden, so the last keystrokes survive. */
function flushDraft(): void {
  if (!draftTimer || !editor) return;
  window.clearTimeout(draftTimer);
  draftTimer = undefined;
  void saveDraft(editor.getText(), currentLanguageId);
}

async function restoreDraft(): Promise<void> {
  if (!editor) return;
  const draft = await loadDraft();
  if (!draft || editor.getText().length > 0) return;
  if (draft.language && draft.language !== currentLanguageId) setLanguage(draft.language, false);
  editor.setText(draft.text);
  updateInsertState();
  showToast('Restored unsaved code');
  recordHealth('draft-restore', `${draft.text.length} chars`, true);
}

/* ── insert ────────────────────────────────────────────────────────────── */

function payloadFor(text: string): string {
  const trimmed = text.replace(/^\n+/, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  if (trimmed.length === 0) return '';
  if (!settings.wrapInFence) return trimmed;
  if (/^```[^\n]*\n[\s\S]*```$/.test(trimmed)) return trimmed;
  return `\`\`\`${getLanguageMeta(currentLanguageId).fence}\n${trimmed}\n\`\`\``;
}

function alreadyInPromptBox(payload: string): boolean {
  if (!payload || payload !== lastInserted) return false;
  return promptBoxContains(payload, match?.element ?? null);
}

function updateInsertState(): void {
  const text = editor?.getText() ?? '';
  const payload = payloadFor(text);
  const empty = payload.length === 0;

  // Duplicates are caught at click time (see doInsert) rather than by
  // disabling the button: the prompt box can change while the panel is open.
  if (insertButton) {
    insertButton.disabled = empty;
    insertButton.title = `${adapter.copy.insertHint} (${MOD_KEY}+Enter)`;
  }
  if (sendButton) sendButton.disabled = empty;

  if (countLabel) {
    const lines = text.length === 0 ? 0 : text.split('\n').length;
    const duplicate = !empty && alreadyInPromptBox(payload);
    countLabel.textContent = duplicate
      ? `${lines} line${lines === 1 ? '' : 's'} · already in the prompt box`
      : `${lines} line${lines === 1 ? '' : 's'} · ${text.length} chars`;
  }
}

async function doInsert(mode: 'insert' | 'send'): Promise<void> {
  const text = editor?.getText() ?? '';
  const payload = payloadFor(text);
  if (payload.length === 0) {
    showToast('Nothing to insert');
    return;
  }
  if (alreadyInPromptBox(payload)) {
    showToast('That code is already in the prompt box');
    return;
  }

  // The insert path needs the site's own prompt box rendered and focusable, so
  // its row comes back for the duration.
  showComposerRow();
  inserting = true;
  const result = await insertIntoPromptBox(payload).finally(() => {
    inserting = false;
  });
  if (!result.ok) {
    if (dock) hideComposerRow(dock);
    const copied = await copyToClipboard(payload);
    showToast(
      copied
        ? 'Could not insert — code copied to the clipboard'
        : result.reason ?? 'Could not insert the code',
      'error',
    );
    recordHealth('insert', `${result.reason ?? 'failed'}${copied ? ' (copied)' : ''}`, false);
    return;
  }

  lastInserted = payload;
  if (draftTimer) window.clearTimeout(draftTimer);
  draftTimer = undefined;
  void clearDraft();
  closePanel();
  updateInsertState();
  recordHealth('insert', result.method, result.verified);

  if (mode === 'send') {
    await nextPaint(2);
    const sent = await sendChatMessage();
    if (!sent.ok) {
      showToast(sent.reason ?? 'Inserted, but the send button was not found', 'error');
      recordHealth('send', sent.reason ?? 'not found', false);
    } else {
      showToast(adapter.copy.sent);
      recordHealth('send', 'clicked', true);
    }
  } else {
    showToast(
      result.verified
        ? `Inserted into the prompt box (${result.method})`
        : result.reason ?? 'Inserted — please double-check the prompt box',
      result.verified ? 'info' : 'error',
    );
  }
}

function onEditorPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!text.trim() || !editor) return;
  if (editor.getText().trim().length > 0) return;
  const guessed = guessLanguage(text);
  if (guessed && guessed !== currentLanguageId) {
    setLanguage(guessed, true);
    showToast(`Detected ${getLanguageMeta(guessed).label}`);
  }
}

/* ── toast ─────────────────────────────────────────────────────────────── */

function showToast(message: string, kind: 'info' | 'error' = 'info'): void {
  const { shadow: root } = ensureOverlayHost();
  if (!toast || !toast.isConnected) {
    toast = element('div', 'gci-toast');
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    root.appendChild(toast);
  }
  toast.classList.toggle('gci-dark', isPageDark());
  toast.textContent = message;
  toast.classList.toggle('gci-toast-error', kind === 'error');
  toast.classList.add('gci-toast-visible');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove('gci-toast-visible'), 2800);
}

/* ── anchoring and layout ──────────────────────────────────────────────── */

function refreshMatch(): InputMatch | null {
  const found = findChatInput();
  // While the editor is docked, the site's own text row is hidden on purpose,
  // so the prompt box fails a visibility-based lookup: keep the match we
  // already hold until the element is really gone.
  if (!found && dock && match?.element.isConnected) return match;
  const changed = found?.element !== match?.element || found?.selector !== match?.selector;
  match = found;
  if (match?.selector !== lastStatusSelector) {
    lastStatusSelector = match?.selector ?? '';
    recordHealth('detect', match?.selector ?? 'not found', Boolean(match));
  }
  if (changed) {
    updateLauncherVisibility();
    observeComposer();
    if (isOpen) layoutPanel();
  }
  return match;
}

function observeComposer(): void {
  composerObserver?.disconnect();
  composerObserver = null;
  const box = match ? findComposerBox(match.element) : null;
  if (!box || typeof ResizeObserver === 'undefined') return;
  composerObserver = new ResizeObserver(() => {
    if (isOpen) layoutPanel();
    else mountLauncher();
  });
  composerObserver.observe(box);
}

function scheduleLayout(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    // Re-check the inline chip after a scroll/resize: its row may have moved,
    // or a page overlay may now cover it.
    if (!isOpen) mountLauncher();
    if (isOpen) {
      layoutPanel();
      updateTheme();
    }
  });
}

/**
 * The host re-renders the composer as the prompt grows, which can drop our row
 * or our chip out of the DOM. Put them back when that happens.
 */
function syncDock(): void {
  if (!isOpen || !dock || !panelHost || inserting) return;
  const fresh = match ? findComposerDock(match.element) : null;
  if (!dock.box.isConnected) {
    if (!fresh) {
      releaseDock();
      layoutPanel();
      return;
    }
    dock = fresh;
  } else if (fresh && fresh.box === dock.box && fresh.row !== dock.row) {
    // The host replaced the text row inside the same box: track the new one.
    dock = fresh;
  }
  if (panelHost.parentElement !== dock.box) dock.box.appendChild(panelHost);
  if (dock.row.isConnected && getComputedStyle(dock.row).display !== 'none') {
    hideComposerRow(dock);
  }
}

function observePage(): void {
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      // Mid-insert the dock layout is deliberately different: leave it alone.
      if (inserting) return;
      const previous = match?.element ?? null;
      refreshMatch();
      if (!isOpen) {
        // Idempotent: moves the chip only if the host rebuilt its action row.
        mountLauncher();
        return;
      }
      if (previous !== (match?.element ?? null)) {
        // The prompt box was replaced: dock into the new one, or fall back.
        const target = match ? findComposerDock(match.element) : null;
        if (target) mountDocked(target);
        else {
          if (dock) releaseDock();
          layoutPanel();
        }
        return;
      }
      syncDock();
    }, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* ── keyboard and focus ────────────────────────────────────────────────── */

function onHotkey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat) return;
  const shortcut = settings.shortcut || DEFAULT_SETTINGS.shortcut;
  if (!matchesShortcut(event, shortcut)) return;
  event.preventDefault();
  event.stopPropagation();
  togglePanel();
}

function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !isOpen) return;
  // Let the editor's own overlays (search bar, autocomplete) handle it first.
  if (editorOverlayBusy()) return;
  event.preventDefault();
  event.stopPropagation();
  closePanel();
}

/**
 * Whether CodeMirror has an overlay open that wants the Escape key first. A
 * tooltip node lingers in the DOM after the autocomplete closes (it is only
 * hidden), which used to swallow Escape on the real page — only a tooltip with a
 * box on screen counts.
 */
function editorOverlayBusy(): boolean {
  if (!panelShadow) return false;
  for (const node of panelShadow.querySelectorAll('.cm-panel, .cm-tooltip')) {
    if (node.getClientRects().length > 0) return true;
  }
  return false;
}

/**
 * Clicking away from the box closes the editor, the way the site's own expanded
 * composer collapses — but it only hides it: the code stays in the editor and
 * comes back the next time it is opened.
 */
function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  const deepTarget = composedTarget(event);
  if (deepTarget instanceof Node) {
    // Even when no composer is open, remember the editable the user clicked.
    rememberFocusedComposer(deepTarget);
  }
  if (target instanceof Node) {
    if (!isOpen) {
      const previous = match?.element ?? null;
      refreshMatch();
      if (previous !== (match?.element ?? null)) {
        mountLauncher();
        observeComposer();
      }
    }
  }

  if (!isOpen || !(target instanceof Node)) return;

  if (dock) {
    // Docked: clicks inside the box (our editor, the site's own buttons) keep
    // it open, and so do our own overlay pieces.
    if (dock.box.contains(target)) return;
    if (overlayHost?.contains(target)) return;
    closePanel(false);
    return;
  }

  // Floating: clicking anywhere outside the panel closes it, like any other
  // transient editor.
  if (panelHost?.contains(target)) return;
  if (launcherHost?.contains(target)) return;
  if (overlayHost?.contains(target)) return;
  closePanel(false);
}

/**
 * The site's own expand/collapse button sits in the box's top-right corner.
 * Rather than fight it for the same pixel, a click on it closes the editor too.
 */
function onBoxButtonClick(event: MouseEvent): void {
  if (!isOpen || !dock) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const wrapper = target.closest('[class*="input-buttons-wrapper"]');
  if (!wrapper || !dock.box.contains(wrapper)) return;
  closePanel();
}

/* ── boot ──────────────────────────────────────────────────────────────── */

function status() {
  const launcherMounted = Boolean(launcherHost?.isConnected);
  return {
    adapter: adapter.id,
    adapterName: adapter.name,
    found: Boolean(match),
    selector: match?.selector ?? null,
    open: isOpen,
    docked: Boolean(dock),
    launcher: isOpen || !launcherMounted
      ? 'hidden'
      : launcherHost?.classList.contains('gci-inline')
        ? 'inline'
        : 'floating',
    repair: hasRepairDescriptor(),
    url: location.href,
    /** What the Send button would click — the thing to check when sending fails. */
    send: describeSendButton(),
  };
}

export function start(siteAdapter: SiteAdapter): void {
  adapter = siteAdapter;
  setActiveAdapter(siteAdapter);
  document.documentElement.dataset.gciAdapter = siteAdapter.id;

  // Wire everything up synchronously so the shortcut responds on the very first
  // frame; settings arrive asynchronously and are applied when they land.
  const { shadow: root } = ensureLauncherHost();
  buildLauncher(root);
  updateTheme(true);

  observePage();
  window.addEventListener('keydown', onHotkey, true);
  window.addEventListener('keydown', onEscape, true);
  window.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('click', onBoxButtonClick, true);
  window.addEventListener(
    'focusin',
    (event) => {
      const target = composedTarget(event);
      rememberFocusedComposer(target);
      if (!isOpen) {
        const previous = match?.element ?? null;
        refreshMatch();
        if (previous !== (match?.element ?? null)) mountLauncher();
      }
    },
    true,
  );
  window.addEventListener('scroll', scheduleLayout, { capture: true, passive: true });
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDraft();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateTheme(true));

  onSettingsChanged((next) => {
    const wrapChanged = next.wrapLines !== settings.wrapLines;
    const placementChanged = next.launcherMode !== settings.launcherMode;
    settings = next;
    if (placementChanged) {
      launcherPlacement = null;
      launcherHiddenSince = 0;
      floatingRecoveryDone = false;
      cancelFloatingRecovery();
    }
    syncControls();
    updateLauncherTitle();
    updateLauncherVisibility();
    if (wrapChanged) editor?.setWrap(settings.wrapLines);
    if (isOpen) layoutPanel();
    updateInsertState();
  });

  ext.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const type = (message as { type?: string } | null)?.type;
    if (type === 'gci:ping') {
      refreshMatch();
      sendResponse(status());
      return true;
    }
    if (type === 'gci:diag') {
      refreshMatch();
      sendResponse({ ...status(), health: healthReport() });
      return true;
    }
    if (type === 'gci:pick') {
      if (isOpen) closePanel(false);
      startPicker((element) => {
        rememberFocusedComposer(element);
        refreshMatch();
        updateLauncherVisibility();
        showToast('Prompt box saved for this site');
        recordHealth('picker', 'saved', true);
      });
      sendResponse({ ok: true });
      return true;
    }
    if (type === 'gci:toggle') {
      togglePanel();
      sendResponse(status());
      return true;
    }
    if (type === 'gci:open') {
      openPanel();
      sendResponse(status());
      return true;
    }
    if (type === 'gci:close') {
      closePanel();
      sendResponse(status());
      return true;
    }
    return false;
  });

  void loadRepairDescriptor().then(() => {
    refreshMatch();
    mountLauncher();
    observeComposer();
  });

  void loadSettings().then((loaded) => {
    settings = loaded;
    currentLanguageId = loaded.language;
    syncControls();
    updateLauncherTitle();
    updateLauncherVisibility();
    updateInsertState();
  });
}
