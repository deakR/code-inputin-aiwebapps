/**
 * User-assisted repair: click the real prompt box once, and the extension
 * stores a descriptor it can match after the next redesign.
 */

import { isEditableElement, isVisible, saveRepairDescriptor } from './dom';

const HOST_ID = 'gci-picker';
const STYLE = `
  :host { all: initial; }
  .gci-pick-bar {
    position: fixed;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    padding: 9px 14px;
    border-radius: 999px;
    background: #202124;
    color: #f1f3f4;
    font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    pointer-events: none;
    white-space: nowrap;
  }
  .gci-pick-box {
    position: fixed;
    z-index: 2147483646;
    border: 2px dashed #8ab4f8;
    background: rgba(138, 180, 248, 0.12);
    border-radius: 6px;
    pointer-events: none;
    display: none;
  }
`;

let cleanupPicker: (() => void) | null = null;

export function isPickerOpen(): boolean {
  return cleanupPicker !== null;
}

function deepElementFromPoint(x: number, y: number): Element | null {
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
}

function editableAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest('textarea, [contenteditable="true"], [role="textbox"]');
  if (!(element instanceof HTMLElement)) return null;
  if (!isEditableElement(element)) return null;
  if (!isVisible(element, 60, 14)) return null;
  if (element.closest(`#${HOST_ID}`)) return null;
  return element;
}

export function startPicker(onPicked: (element: HTMLElement) => void): void {
  if (cleanupPicker) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.setProperty('position', 'fixed');
  host.style.setProperty('inset', '0');
  host.style.setProperty('pointer-events', 'none');
  host.style.setProperty('z-index', '2147483647');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'gci-pick-bar';
  bar.textContent = 'Pick the prompt box: click the text input. Esc to cancel.';
  shadow.appendChild(bar);

  const box = document.createElement('div');
  box.className = 'gci-pick-box';
  shadow.appendChild(box);

  const highlight = (element: HTMLElement | null) => {
    if (!element) {
      box.style.display = 'none';
      return;
    }
    const rect = element.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.top)}px`;
    box.style.width = `${Math.round(rect.width)}px`;
    box.style.height = `${Math.round(rect.height)}px`;
  };

  const onMove = (event: PointerEvent) => {
    highlight(editableAt(deepElementFromPoint(event.clientX, event.clientY)));
  };

  const onDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onClick = (event: MouseEvent) => {
    const target = editableAt(deepElementFromPoint(event.clientX, event.clientY));
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    void saveRepairDescriptor(target).then(() => onPicked(target));
    cleanup();
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    host.remove();
    cleanupPicker = null;
  };

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  (document.body ?? document.documentElement).appendChild(host);
  cleanupPicker = cleanup;
}
