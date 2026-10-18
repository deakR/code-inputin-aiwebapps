/**
 * The panel: a shadow-DOM sidecar for Gemini's prompt box.
 *
 * Everything Gemini can see is a single zero-impact overlay element. All UI
 * lives inside a shadow root, all page-facing interactions go through
 * `./dom`, `./inject` and a small set of message handlers.
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
  onSettingsChanged,
  saveSettings,
  type Settings,
} from '../shared/settings';
import {
  findChatInput,
  findComposerBox,
  findComposerDock,
  findInputContainer,
  type ComposerDock,
  type InputMatch,
} from './dom';
import { insertIntoPromptBox, promptBoxContains, sendChatMessage, describeSendButton } from './inject';
import panelStyles from './panel.css';

/** Launcher + toast: always a viewport-anchored overlay. */
const OVERLAY_HOST_ID = 'gci-root';
/** The panel: docked into Gemini's input box, or a floating overlay as fallback. */
const PANEL_HOST_ID = 'gci-inbox';
const SVG_NS = 'http://www.w3.org/2000/svg';
const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
const TOGGLE_LABEL = IS_MAC ? '⌘⇧E' : 'Ctrl+Shift+E';

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

let settings: Settings = { ...DEFAULT_SETTINGS };
let overlayHost: HTMLElement | null = null;
let overlayShadow: ShadowRoot | null = null;
let panelHost: HTMLElement | null = null;
let panelShadow: ShadowRoot | null = null;
/** Set while the panel sits inside Gemini's own input box. */
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
let themeCheckedAt = 0;
let layoutQueued = false;

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
 * Two hosts on purpose. The launcher and the toast have to stay anchored to the
 * viewport, and the input box sits under an ancestor with a CSS transform on the
 * real page (`input-area-container` is translated), which would turn
 * `position: fixed` inside a docked panel into "fixed to the input area". So the
 * panel moves into the box, and the overlay never does.
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
] as const;

function applyHostStyles(node: HTMLElement, mode: 'overlay' | 'docked'): void {
  const style = node.style;
  for (const property of HOST_PROPS) style.removeProperty(property);
  style.setProperty('pointer-events', 'none', 'important');
  if (mode === 'overlay') {
    style.setProperty('position', 'fixed', 'important');
    style.setProperty('inset', '0', 'important');
    style.setProperty('z-index', '2147483647', 'important');
    return;
  }
  // Docked: part of Gemini's own flow, as a full-width row of the input box's
  // grid, sized by the panel inside it.
  style.setProperty('position', 'relative', 'important');
  style.setProperty('width', '100%', 'important');
  style.setProperty('height', 'auto', 'important');
  style.setProperty('grid-column', '1 / -1', 'important');
}

/**
 * The page's own UI font. `all: initial` in the stylesheet cuts inheritance at
 * the shadow boundary, so the family has to be handed across explicitly — it is
 * what makes our strip's labels look like part of Gemini.
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

function createHost(id: string): { host: HTMLElement; shadow: ShadowRoot } {
  const node = element('div');
  node.id = id;
  applyHostStyles(node, 'overlay');
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

  (document.body ?? document.documentElement).appendChild(node);
  return { host: node, shadow: root };
}

function ensureOverlayHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (!overlayHost || !overlayShadow) {
    const created = createHost(OVERLAY_HOST_ID);
    overlayHost = created.host;
    overlayShadow = created.shadow;
  }
  return { host: overlayHost, shadow: overlayShadow };
}

function ensurePanelHost(): { host: HTMLElement; shadow: ShadowRoot } {
  if (!panelHost || !panelShadow) {
    const created = createHost(PANEL_HOST_ID);
    panelHost = created.host;
    panelShadow = created.shadow;
  }
  return { host: panelHost, shadow: panelShadow };
}

/** Stops UI events from escaping into Gemini's own handlers. */
function installEventBarrier(node: HTMLElement): void {
  const stop = (event: Event) => event.stopPropagation();
  for (const type of BARRIER_EVENTS) node.addEventListener(type, stop, false);
}

/* ── launcher ──────────────────────────────────────────────────────────── */

function buildLauncher(root: ShadowRoot): void {
  if (launcher) return;
  const button = element('button', 'gci-launcher');
  button.type = 'button';
  // Icon-only chip: the wording lives in the tooltip and the accessible name, so
  // the pill stays a small square of pixels beside the prompt box.
  const label = `Code editor (${TOGGLE_LABEL})`;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.hidden = true;
  button.appendChild(svgIcon('M10 6 L4 12 L10 18', 'M14 6 L20 12 L14 18'));
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });
  root.appendChild(button);
  launcher = button;
}

function updateLauncherVisibility(): void {
  if (!launcher) return;
  const visible = Boolean(match) && settings.showLauncher && !isOpen;
  if (!visible) {
    launcher.hidden = true;
    return;
  }
  launcher.hidden = false;
  layoutLauncher();
  followLauncher();
}

let launcherFollow = 0;

/**
 * Keeps re-anchoring the pill for a few frames (≈0.7 s). Gemini animates its own
 * layout — the start screen becomes the chat view, the composer grows, shrinks
 * and re-renders — which moves the input box without firing a scroll or resize
 * event, and a pill positioned by coordinates would otherwise be left where the
 * box used to be.
 */
function followLauncher(frames = 40): void {
  if (launcherFollow) return;
  let remaining = frames;
  launcherFollow = requestAnimationFrame(function step() {
    remaining -= 1;
    if (launcher && !launcher.hidden) layoutLauncher();
    launcherFollow = remaining > 0 ? requestAnimationFrame(step) : 0;
  });
}

/**
 * Anchors the pill against Gemini's input box, not the text area: the box is
 * always laid out, while the text row is hidden for as long as the editor is
 * docked (a hidden element measures 0×0, which used to park the pill at the top
 * of the window).
 *
 * Gemini moves the composer around as the conversation grows and animates its
 * own layout, so the position also has a follow loop (`followLauncher`) and a
 * clamp that keeps the pill in the box's neighbourhood even if a stale value
 * ever slipped through.
 */
function layoutLauncher(): void {
  if (!launcher || launcher.hidden) return;
  const width = launcher.offsetWidth || 28;
  const height = launcher.offsetHeight || 28;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const position = settings.launcherPosition;

  const box = match ? findComposerBox(match.element) : null;
  const container = box ?? (match ? findInputContainer(match.element) : null);
  const rect = container?.getBoundingClientRect();

  let left: number;
  let top: number;

  if (!rect || position === 'fixed-bottom-right') {
    left = viewportWidth - width - 20;
    top = viewportHeight - height - 20;
  } else if (position === 'above-left') {
    left = rect.left + 16;
    top = rect.top - height - 8;
  } else if (position === 'inside-left') {
    left = rect.left + 48;
    top = rect.bottom - height - 10;
  } else {
    left = rect.right - width - 48;
    top = rect.bottom - height - 10;
  }

  if (rect && position !== 'fixed-bottom-right') {
    // Never let a stale measurement throw the pill into the middle of the
    // conversation: stay within a small band around the box.
    const band = position === 'above-left' ? 56 : 0;
    top = clamp(top, rect.top - height - band, Math.max(rect.top - height - 6, rect.bottom - height + 2));
  }

  const maxLeft = Math.max(8, viewportWidth - width - 8);
  launcher.style.left = `${Math.round(clamp(left, 8, maxLeft))}px`;
  launcher.style.top = `${Math.round(clamp(top, 6, Math.max(6, viewportHeight - height - 6)))}px`;
  // The slide is only wanted while following Gemini's layout, not on the first
  // placement (which would fly in from the top-left corner).
  launcher.classList.add('gci-placed');
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
  send.title = 'Insert and press Gemini’s send button';
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
}

/* ── editor loading ────────────────────────────────────────────────────── */

type EditorModule = typeof import('../composer/editor');

let editorModulePromise: Promise<EditorModule> | null = null;

/**
 * CodeMirror lives in `dist/composer.js` (with one chunk per language under
 * `dist/composer/`) and is imported on first use, so an ordinary Gemini page
 * load never pays for any of it.
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
      onChange: () => updateInsertState(),
      onInsert: () => void doInsert('insert'),
    });
    updateInsertState();
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
    console.error('[gemini-code-input] could not load the editor chunk', error);
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

  const container = match ? findInputContainer(match.element) : null;
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
 * snippet gets a small box, like Gemini's own composer. Floating, the setting is
 * the panel height.
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
  editor?.setDark(dark);
}

/* ── open / close ──────────────────────────────────────────────────────── */

/**
 * Docks the panel into Gemini's input box: the host becomes a full-width row of
 * the box's grid, Gemini's own text row steps aside, and the box grows to hold
 * the editor — the same shape Gemini itself uses for a multi-line prompt.
 */
function mountDocked(target: ComposerDock): void {
  const { host: node, shadow: root } = ensurePanelHost();
  buildPanel(root);
  if (!panel) return;

  // Moving to another box (Gemini rebuilt the composer): give the old row back.
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

/** Gemini's own text row steps aside while the editor holds its place. */
function hideComposerRow(target: ComposerDock): void {
  target.row.style.setProperty('display', 'none', 'important');
}

/** …and comes back for the insert, which needs the real prompt box rendered. */
function showComposerRow(): void {
  if (dock && dock.row.isConnected) dock.row.style.removeProperty('display');
}

/**
 * Hands the box back to Gemini: the text row returns (the insert path needs the
 * real prompt box rendered) and the panel host goes back to the body overlay.
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
  if (launcher) launcher.hidden = true;

  syncControls();
  updateTheme(true);

  const target = match ? findComposerDock(match.element) : null;
  if (target) mountDocked(target);
  else mountFloating();

  updateInsertState();
  void activateEditor();
}

function closePanel(focusPromptBox = true): void {
  releaseDock();
  // Drop any autocomplete popup with the panel: CodeMirror remembers the
  // completion state and would show it again the moment the view is refocused
  // (verified on the real page, where that swallowed the first Escape).
  editor?.closeCompletion();
  if (panel) panel.hidden = true;
  isOpen = false;
  updateLauncherVisibility();
  if (focusPromptBox) refreshMatch()?.element.focus();
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
    console.error('[gemini-code-input] could not load the language package', error);
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
    insertButton.title = `Insert into the prompt box (${MOD_KEY}+Enter)`;
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

  // The insert path needs Gemini's own prompt box rendered and focusable, so its
  // row comes back for the duration. The editor stays on screen — and keeps its
  // code — until the text has actually landed: closing it first would leave the
  // input box briefly empty and make "the panel is gone" mean "not inserted yet".
  showComposerRow();
  inserting = true;
  const result = await insertIntoPromptBox(payload).finally(() => {
    inserting = false;
  });
  if (!result.ok) {
    if (dock) hideComposerRow(dock);
    showToast(result.reason ?? 'Could not insert the code', 'error');
    return;
  }

  lastInserted = payload;
  closePanel();
  updateInsertState();

  if (mode === 'send') {
    await nextPaint(2);
    const sent = sendChatMessage();
    if (!sent.ok) showToast(sent.reason ?? 'Inserted, but the send button was not found', 'error');
    else showToast('Sent to Gemini');
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
    root.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('gci-toast-error', kind === 'error');
  toast.classList.add('gci-toast-visible');
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.classList.remove('gci-toast-visible'), 2800);
}

/* ── anchoring and layout ──────────────────────────────────────────────── */

function refreshMatch(): InputMatch | null {
  const found = findChatInput();
  // While the editor is docked, Gemini's own text row is hidden on purpose, so
  // the prompt box fails a visibility-based lookup: keep the match we already
  // hold until the element is really gone.
  if (!found && dock && match?.element.isConnected) return match;
  const changed = found?.element !== match?.element || found?.selector !== match?.selector;
  match = found;
  if (changed) {
    updateLauncherVisibility();
    if (isOpen) layoutPanel();
  }
  return match;
}

function scheduleLayout(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    if (launcher && !launcher.hidden) {
      layoutLauncher();
      followLauncher(20);
    }
    if (isOpen) {
      layoutPanel();
      updateTheme();
    }
  });
}

/**
 * Angular re-renders the input area as the prompt grows, which can drop our row
 * out of the box or un-hide the text row. Put the dock back when that happens.
 */
function syncDock(): void {
  // Mid-insert the text row is deliberately visible: leave the layout alone.
  if (!isOpen || !dock || !panelHost || inserting) return;
  const fresh = match ? findComposerDock(match.element) : null;
  if (!dock.box.isConnected) {
    if (!fresh) return;
    dock = fresh;
  } else if (fresh && fresh.box === dock.box && fresh.row !== dock.row) {
    // Angular replaced the text row inside the same box: track the new one.
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
      // The composer may have moved or resized without a scroll or resize
      // event: re-anchor the pill (it is hidden while the panel is open).
      if (launcher && !launcher.hidden) followLauncher();
      if (!isOpen) return;
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
    }, 300);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* ── keyboard ──────────────────────────────────────────────────────────── */

function onHotkey(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.repeat) return;
  const isToggle =
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    (event.code === 'KeyE' || event.key?.toLowerCase() === 'e');
  if (!isToggle) return;
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
 * Clicking away from the box closes the editor, the way Gemini's own expanded
 * composer collapses — but it only hides it: the code stays in the editor and
 * comes back the next time it is opened.
 */
function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen || !dock) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  // Clicks inside the box (our editor, Gemini's own buttons) keep it open, and
  // so do our own overlay pieces (the toast in the corner).
  if (dock.box.contains(target)) return;
  if (overlayHost?.contains(target)) return;
  closePanel(false);
}

/**
 * Gemini's own expand/collapse button sits in the box's top-right corner. Rather
 * than fight it for the same pixel — our close button used to land right on top
 * of it — a click on it closes the editor too, so the affordance the user
 * already knows does the expected thing.
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
  return {
    found: Boolean(match),
    selector: match?.selector ?? null,
    open: isOpen,
    docked: Boolean(dock),
    url: location.href,
    /** What the Send button would click — the thing to check when sending fails. */
    send: describeSendButton(),
  };
}

export function start(): void {
  // Wire everything up synchronously so the shortcut responds on the very first
  // frame; settings arrive asynchronously and are applied when they land.
  const { shadow: root } = ensureOverlayHost();
  buildLauncher(root);

  observePage();
  window.addEventListener('keydown', onHotkey, true);
  window.addEventListener('keydown', onEscape, true);
  window.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('click', onBoxButtonClick, true);
  window.addEventListener('scroll', scheduleLayout, { capture: true, passive: true });
  window.addEventListener('resize', scheduleLayout);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateTheme(true));

  onSettingsChanged((next) => {
    const wrapChanged = next.wrapLines !== settings.wrapLines;
    settings = next;
    syncControls();
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

  refreshMatch();
  updateTheme(true);

  void loadSettings().then((loaded) => {
    settings = loaded;
    currentLanguageId = loaded.language;
    syncControls();
    updateLauncherVisibility();
    updateInsertState();
  });
}
