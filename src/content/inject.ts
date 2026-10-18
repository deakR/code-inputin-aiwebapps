/**
 * Writing text into Gemini's prompt box.
 *
 * The prompt box is a Quill-style contenteditable, so the text has to go in
 * through a path the editor itself understands. We try a few strategies, in
 * order of how "native" they are, and after every attempt we read the box back
 * and check whether the payload actually landed. If an attempt changed the box
 * at all we stop there — a partial insert is better than a duplicated one.
 */

import { findChatInput, findInputContainer, readInputText, type InputMatch } from './dom';

export type InsertMethod = 'paste' | 'execCommand' | 'execCommand-lines' | 'dom';

export interface InsertResult {
  ok: boolean;
  method: InsertMethod | 'none';
  /** True when the payload was found in the box afterwards. */
  verified: boolean;
  reason?: string;
}

/** Loose comparison text: unify line endings, drop zero-width characters, strip trailing spaces. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function matchesPayload(haystack: string, payload: string): boolean {
  const needle = normalizeForCompare(payload);
  if (needle.length === 0) return false;
  if (haystack.includes(needle)) return true;
  // Some editors convert tabs to spaces when they re-render.
  const spaced = (text: string) => normalizeForCompare(text).replace(/\t/g, '    ');
  if (spaced(haystack).includes(spaced(payload))) return true;
  // Last resort: compare with all whitespace removed. Gemini's editor re-renders
  // the text it was given and a round trip through innerText can join lines
  // ("```pythondef add…"); the characters still have to appear in order, which is
  // what tells a real insert apart from a swallowed one.
  const squash = (text: string) => spaced(text).replace(/\s+/g, '');
  return squash(haystack).includes(squash(payload));
}

function currentRangeInside(input: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return input.contains(range.startContainer) ? range.cloneRange() : null;
}

function placeCaretAtEnd(input: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  // Inside the last block, not at the editor root: a caret that sits between
  // blocks makes the browser join the first line of an insert to the previous
  // one, which is how "```pythondef add(a, b):" happens.
  const last = input.lastElementChild ?? input;
  const range = document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * A contenteditable caret is allowed to sit directly on the editor element —
 * between blocks — and inserting multi-line text from there merges the first
 * line with its neighbour ("```pythondef add…"). Move such a caret into the last
 * block; a caret that is already inside one is left alone, so inserting where the
 * user left the caret still works.
 */
function ensureCaretInsideBlock(input: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const insideBlock = range && input.contains(range.startContainer) && range.startContainer !== input;
  if (!insideBlock) placeCaretAtEnd(input);
}

function prepare(input: HTMLElement): void {
  input.focus();
  ensureCaretInsideBlock(input);
  input.classList.remove('ql-blank');
}

function execInsert(text: string): boolean {
  try {
    return document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

/** Pasting through a synthetic ClipboardEvent lets the editor run its own paste pipeline. */
function insertViaPaste(input: HTMLElement, text: string): boolean {
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    // A handler that understood the paste will have called preventDefault.
    return !input.dispatchEvent(event);
  } catch {
    return false;
  }
}

/**
 * Gives an editor's (possibly asynchronous) paste/input pipeline a chance to
 * finish before we read the box back.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

/**
 * One editor-native line break per line, then the line's text.
 *
 * `insertParagraph` is what makes a *real* block per line in Quill and in
 * Gemini's rich-query editor. `insertLineBreak` is only a soft break: the page
 * then re-parses the block and can swallow a line boundary, and a single
 * multi-line `insertText` gets rewritten the same way (leading spaces come back
 * as non-breaking spaces).
 */
function insertViaLineBreaks(text: string): boolean {
  const lines = text.split('\n');
  let separator = 'insertParagraph';
  let any = false;

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      let broke = false;
      try {
        broke = document.execCommand(separator);
      } catch {
        broke = false;
      }
      if (!broke && separator === 'insertParagraph') {
        separator = 'insertLineBreak';
        try {
          document.execCommand(separator);
        } catch {
          /* keep going */
        }
      }
    }
    if (lines[i].length > 0 && execInsert(lines[i])) any = true;
  }
  return any;
}

function insertViaDom(input: HTMLElement, text: string): boolean {
  const selection = window.getSelection();
  if (!selection) return false;

  let range = currentRangeInside(input);
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
  }
  range.deleteContents();

  const fragment = document.createDocumentFragment();
  let last: Node | null = null;
  text.split('\n').forEach((line, index) => {
    if (index > 0) {
      const br = document.createElement('br');
      fragment.appendChild(br);
      last = br;
    }
    if (line.length > 0) {
      const node = document.createTextNode(line);
      fragment.appendChild(node);
      last = node;
    }
  });
  range.insertNode(fragment);

  if (last) {
    const caret = document.createRange();
    caret.setStartAfter(last);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  return true;
}

function notifyInput(input: HTMLElement): void {
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/**
 * Where the caret is, in the terms that matter for inserting: a caret parked on
 * the editor element itself is "editor-root", and inserting from there merges the
 * first line with the next one.
 */
function describeCaret(input: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 'no range';
  const range = selection.getRangeAt(0);
  if (range.startContainer === input) return 'editor-root';
  return input.contains(range.startContainer) ? 'inside-block' : 'outside';
}

/**
 * Diagnostic trace: with `localStorage.setItem('gci-debug', '1')` the insert path
 * records what it did and what the prompt box looked like into a hidden
 * `#gci-debug-out` element, which is the first thing to read when an insert
 * misbehaves on the real page. Off unless that flag is set.
 */
function debugRecord(step: string, extra: Record<string, unknown> = {}): void {
  try {
    if (localStorage.getItem('gci-debug') !== '1') return;
  } catch {
    return;
  }
  let out = document.getElementById('gci-debug-out');
  if (!out) {
    out = document.createElement('pre');
    out.id = 'gci-debug-out';
    // CSSOM property setters, never a style attribute: the same reason the panel
    // styles itself this way.
    out.style.setProperty('display', 'none');
    document.body.appendChild(out);
  }
  const box = document.querySelector('rich-textarea .ql-editor');
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  out.textContent += `${JSON.stringify({
    step,
    caret: range ? `${range.startContainer.nodeName}#${range.startOffset}` : 'no range',
    active: document.activeElement
      ? `${document.activeElement.tagName}${document.activeElement.id ? `#${document.activeElement.id}` : ''}`
      : null,
    boxHtml: box ? box.innerHTML.slice(0, 300) : null,
    ...extra,
  })}\n`;
}

/**
 * How an attempt ended: the payload is in the box, something else is, or the box
 * is byte-identical to before.
 */
type Outcome = 'verified' | 'changed' | 'unchanged';

/**
 * Editors do not all insert synchronously — Gemini's paste pipeline re-renders
 * after the event, so reading the box back immediately reports "nothing
 * happened" and the next strategy would insert a second copy. Poll instead, and
 * only call it a failure once the box has stayed untouched for the whole window.
 */
async function waitForOutcome(
  input: HTMLElement,
  before: string,
  payload: string,
  timeoutMs: number,
): Promise<Outcome> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    await settle();
    const current = normalizeForCompare(readInputText(input));
    if (current !== before) {
      return matchesPayload(current, payload) ? 'verified' : 'changed';
    }
    if (performance.now() >= deadline) return 'unchanged';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
  }
}

export interface InsertOptions {
  /** Reuse an existing match instead of looking the input up again. */
  match?: InputMatch | null;
}

export async function insertIntoPromptBox(
  text: string,
  options: InsertOptions = {},
): Promise<InsertResult> {
  if (text.trim().length === 0) {
    return { ok: false, method: 'none', verified: false, reason: 'nothing to insert' };
  }

  const match = options.match ?? findChatInput();
  const input = match?.element;
  if (!input) {
    return { ok: false, method: 'none', verified: false, reason: 'prompt box not found' };
  }

  if (input instanceof HTMLTextAreaElement) {
    return insertIntoTextarea(input, text);
  }

  const before = normalizeForCompare(readInputText(input));
  debugRecord('start', { payload: JSON.stringify(text), before: JSON.stringify(before) });
  prepare(input);
  debugRecord('prepared');

  // Least invasive first. On the real page a synthetic paste is ignored outright
  // (Gemini only handles trusted paste events), so its window is short: it only
  // needs to cover an editor that inserts a beat after the event.
  const attempts: Array<[InsertMethod, () => boolean, number]> = [
    ['paste', () => insertViaPaste(input, text), 350],
    ['execCommand-lines', () => insertViaLineBreaks(text), 400],
    ['execCommand', () => execInsert(text), 400],
    ['dom', () => insertViaDom(input, text), 400],
  ];

  for (const [method, run, timeout] of attempts) {
    // The caret is re-placed per attempt on purpose: dispatching the paste event
    // above leaves the caret on the editor root (before the first paragraph) on
    // the real page, and inserting from there merges the first line with its
    // neighbour. A caret that is already inside a block is left where it is.
    if (method !== 'paste') ensureCaretInsideBlock(input);

    const caretAtStart = describeCaret(input);
    let handled = false;
    try {
      handled = run();
    } catch {
      handled = false;
    }
    debugRecord(`attempt ${method}`, { handled, caretAtStart });
    if (!handled) continue;

    // The execCommand paths fire a trusted input event themselves, and a
    // framework-managed editor that sees a second, synthetic one may re-parse
    // its DOM and rewrite what was just inserted. Only the DOM fallback, which
    // changes the tree behind the editor's back, needs to announce itself.
    if (method === 'dom') notifyInput(input);

    const outcome = await waitForOutcome(input, before, text, timeout);
    debugRecord(`outcome ${method}`, { outcome });
    if (outcome === 'verified') return { ok: true, method, verified: true };
    if (outcome === 'changed') {
      return {
        ok: true,
        method,
        verified: false,
        reason: `inserted via ${method} — please double-check the prompt box`,
      };
    }
    // Nothing landed: the editor swallowed it, so the next strategy may try.
  }

  if (readInputText(input).trim().length === 0) input.classList.add('ql-blank');
  return { ok: false, method: 'none', verified: false, reason: 'every insert strategy failed' };
}

function insertIntoTextarea(input: HTMLTextAreaElement, text: string): InsertResult {
  input.focus();
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = input.value.slice(0, start) + text + input.value.slice(end);

  // Bypass framework value tracking with the native setter.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  if (setter) setter.call(input, next);
  else input.value = next;

  input.selectionStart = input.selectionEnd = start + text.length;
  notifyInput(input);

  return { ok: true, method: 'dom', verified: true };
}

/**
 * True when the prompt box already contains this payload. Pass the element when
 * you already know it: while the editor is docked the text row is hidden, so
 * looking the box up again would fail its visibility check.
 */
export function promptBoxContains(payload: string, element?: HTMLElement | null): boolean {
  const target = element ?? findChatInput()?.element ?? null;
  if (!target) return false;
  return matchesPayload(normalizeForCompare(readInputText(target)), payload);
}

export function findPromptBox(): InputMatch | null {
  return findChatInput();
}

export { findInputContainer };

/**
 * The send button, scored across the signals Gemini has shipped over time: an
 * aria-label, `data-testid="send-button"`, and a ligature icon whose text content
 * is the word "send". Exported so the popup can report what it found.
 */
export function findSendButton(options: { includeDisabled?: boolean } = {}): HTMLElement | null {
  const input = findChatInput();
  const container = input ? findInputContainer(input.element) : null;

  const isDisabled = (button: HTMLElement) =>
    (button as HTMLButtonElement).disabled ||
    button.getAttribute('aria-disabled') === 'true' ||
    button.hasAttribute('disabled');

  const score = (button: HTMLElement): number => {
    const label = (button.getAttribute('aria-label') ?? '').trim();
    const testId = button.getAttribute('data-testid') ?? '';
    const className = button.className?.toString() ?? '';
    const icon = button.querySelector('mat-icon, .material-symbols-outlined, .google-symbols');
    const iconText = (icon?.textContent ?? '').trim().toLowerCase();
    const ownText = (button.textContent ?? '').trim().toLowerCase();

    let value = 0;
    if (/^send(\s+message)?$/i.test(label)) value += 100;
    else if (/^send\b/i.test(label) && !/feedback|comment|report|email/i.test(label)) value += 60;
    else if (/send/i.test(testId) || /send/i.test(className)) value += 40;
    if (iconText === 'send' || iconText === 'send_message') value += 50;
    else if (ownText === 'send') value += 35;
    if (container?.contains(button)) value += 15;
    if (button.closest('[aria-hidden="true"]')) value -= 40;
    return value;
  };

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"], [data-testid*="send" i]'),
  )
    .filter((button) => (options.includeDisabled || !isDisabled(button)) && score(button) > 0)
    .sort((a, b) => score(b) - score(a));

  return candidates[0] ?? null;
}

function labelOf(button: HTMLElement): string {
  const icon = (button.querySelector('mat-icon, .material-symbols-outlined, .google-symbols')?.textContent ?? '').trim();
  return (
    button.getAttribute('aria-label') ??
    button.getAttribute('data-testid') ??
    icon ??
    button.className?.toString().slice(0, 40) ??
    'unnamed'
  );
}

/**
 * What the popup reports. A button that exists but is disabled is a completely
 * different problem from one that was not recognised at all, so say which.
 */
export function describeSendButton(): string {
  const enabled = findSendButton();
  if (enabled) return labelOf(enabled);
  const disabled = findSendButton({ includeDisabled: true });
  return disabled ? `disabled: ${labelOf(disabled)}` : 'not found';
}

/** Clicks Gemini's send button. User-initiated only. */
export function sendChatMessage(): { ok: boolean; reason?: string } {
  if (!findChatInput()) return { ok: false, reason: 'prompt box not found' };
  const target = findSendButton();
  if (!target) return { ok: false, reason: 'send button not found or still disabled' };
  target.click();
  return { ok: true };
}
