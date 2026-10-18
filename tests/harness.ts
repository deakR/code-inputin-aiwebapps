/**
 * Shared Playwright harness: one persistent Chromium (the build Playwright
 * ships — branded Chrome refuses --load-extension) with the built extension
 * loaded, plus helpers for driving the fixture page.
 */
import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const extensionPath = path.join(root, 'dist');
export const FIXTURES = 'http://127.0.0.1:5179/fixtures';
export const FIXTURE_PAGE = `${FIXTURES}/gemini-mock.html`;
export const EXTENSION_NAME = 'Gemini Code Input';

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gci-profile-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('[page error]', message.text());
    });
    page.on('pageerror', (error) => console.log('[page exception]', error.message));
    await use(page);
  },
});

export { expect };

/* ── locators ──────────────────────────────────────────────────────────── */

export const launcher = (page: Page) => page.locator('#gci-root .gci-launcher');
// The panel and its contents live in their own host (`#gci-inbox`): docked
// inside the prompt box most of the time, in the body when it floats. Locators
// are unscoped because Playwright's CSS engine pierces shadow roots, and the
// `gci-` prefix keeps them unique on a Gemini page.
export const panel = (page: Page) => page.locator('.gci-panel');
export const cmContent = (page: Page) => page.locator('.cm-content');
export const cmLines = (page: Page) => page.locator('.cm-line');
export const insertButton = (page: Page) => page.locator('.gci-btn-primary');
export const sendButton = (page: Page) => page.locator('.gci-btn >> nth=0');
export const promptBox = (page: Page) => page.locator('#prompt-editor');
export const toast = (page: Page) => page.locator('.gci-toast');
export const geminiSend = (page: Page) => page.locator('.send-button');
/** Gemini's own text row inside the input box — hidden while the editor is docked. */
export const composerRow = (page: Page) => page.locator('.single-line-format');
/** Height of the rounded input box, which grows when the editor is docked. */
export function composerBoxHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const box = document.querySelector('.text-input-field');
    return box ? Math.round(box.getBoundingClientRect().height) : 0;
  });
}
/** Whether the panel host is docked inside the input box. */
export function panelIsDocked(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.querySelector('.text-input-field #gci-inbox')));
}
/**
 * Distance from the bottom of the Code pill to the top of the input box. It stays
 * small when the pill is anchored to the box and grows large when the pill is
 * left behind by a re-layout (the bug that parked it mid-conversation).
 */
export function launcherGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pill = document.getElementById('gci-root')?.shadowRoot?.querySelector('.gci-launcher');
    const box = document.querySelector('.text-input-field');
    if (!pill || !box) return Number.NaN;
    return Math.round(box.getBoundingClientRect().top - pill.getBoundingClientRect().bottom);
  });
}
/** Editor overlays (autocomplete popup, search panel) that are actually on screen. */
export function visibleEditorOverlays(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shadow = document.getElementById('gci-inbox')?.shadowRoot;
    if (!shadow) return 0;
    return Array.from(shadow.querySelectorAll('.cm-panel, .cm-tooltip')).filter(
      (node) => node.getClientRects().length > 0,
    ).length;
  });
}

/* ── actions ───────────────────────────────────────────────────────────── */

export async function openEditor(page: Page): Promise<void> {
  await launcher(page).click();
  await expect(panel(page)).toBeVisible();
}

export async function typeLines(page: Page, lines: string[]): Promise<void> {
  await cmContent(page).click();
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(lines[index]);
  }
}

export async function writeSample(page: Page): Promise<void> {
  await typeLines(page, ['def add(a, b):', 'return a + b']);
}

/** Opens the panel, types the sample, inserts it and waits for the panel to close. */
export async function insertSample(page: Page): Promise<void> {
  await openEditor(page);
  await writeSample(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();
}

/**
 * The prompt box's lines, without the blank lines that `innerText` reports
 * between block-level paragraphs (that is a rendering detail of the editor, not
 * extra content).
 */
export async function promptLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const box = document.getElementById('prompt-editor');
    if (!box) return [];
    return (box.innerText ?? '')
      .split('\n')
      .map((line) => line.replace(/\u00a0/g, ' ').trimEnd())
      .filter((line) => line.trim().length > 0);
  });
}

export async function clearPromptBox(page: Page): Promise<void> {
  await page.evaluate(() => {
    const box = document.getElementById('prompt-editor');
    if (!box) return;
    box.textContent = '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/* ── extension pages ───────────────────────────────────────────────────── */

/**
 * Unpacked extension ids are a hash of the extension's path, so the only
 * reliable way to learn ours is to ask the browser.
 */
export async function findExtensionId(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  await page.goto('chrome://extensions-internals');
  const dump = await page.locator('body').innerText();
  await page.close();

  for (const chunk of dump.split('"id"')) {
    const id = chunk.match(/^\s*:\s*"([a-p]{32})"/)?.[1];
    if (id && chunk.slice(0, 500).includes(EXTENSION_NAME)) return id;
  }
  throw new Error(`could not find the “${EXTENSION_NAME}” extension id`);
}

export async function openPopup(context: BrowserContext): Promise<Page> {
  const id = await findExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup/popup.html`);
  return page;
}
