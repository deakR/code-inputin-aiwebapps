/**
 * Live site probe.
 *
 *   node tools/probe-site.mjs https://chatgpt.com/
 *
 * Loads the built extension against any URL and prints what the detector sees:
 * adapter, editable candidates, likely send buttons, the launcher host and its
 * actual parent. Use it when a site changes before updating an adapter hint.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const distArg = args.find((arg) => arg.startsWith('--dist='));
const extensionPath = path.join(root, distArg ? distArg.slice('--dist='.length) : 'dist');
const url = args.find((arg) => !arg.startsWith('--')) ?? 'https://gemini.google.com/app';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gci-probe-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const page = await context.newPage();
page.on('pageerror', (error) => console.log('[page exception]', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[page error]', message.text());
});

console.log(`→ ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForTimeout(7000);

const report = await page.evaluate(() => {
  const deep = (selector, rootNode = document) => {
    const found = [];
    const visit = (root) => {
      for (const element of Array.from(root.querySelectorAll(selector))) {
        if (element instanceof HTMLElement) found.push(element);
      }
      for (const element of Array.from(root.querySelectorAll('*'))) {
        const shadow = element.shadowRoot;
        if (shadow) visit(shadow);
      }
    };
    visit(rootNode);
    return found;
  };

  const describe = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      aria: element.getAttribute('aria-label') ?? undefined,
      placeholder: element.getAttribute('placeholder') ?? undefined,
      testid: element.getAttribute('data-testid') ?? undefined,
      role: element.getAttribute('role') ?? undefined,
      cls: element.className?.toString().slice(0, 80) || undefined,
      visible:
        typeof element.checkVisibility === 'function'
          ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : true,
      box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
    };
  };

  const isOurs = (element) => {
    if (element.closest('#gci-root, #gci-inbox, #gci-overlay, #gci-picker')) return true;
    const root = element.getRootNode();
    return root instanceof ShadowRoot && /^gci-/.test(root.host?.id ?? '');
  };

  const candidates = deep('textarea, [contenteditable="true"], [role="textbox"]')
    .filter((element) => !isOurs(element))
    .slice(0, 12)
    .map(describe);

  const buttons = deep('button, [role="button"], [data-testid*="send" i]')
    .filter((element) => /send|submit/i.test(`${element.getAttribute('aria-label')} ${element.getAttribute('data-testid')} ${element.getAttribute('title')} ${element.textContent}`))
    .slice(0, 12)
    .map((element) => ({ ...describe(element), disabled: element.disabled || element.getAttribute('aria-disabled') === 'true' }));

  const findHost = (id) => {
    const found = deep(`#${id}`);
    return found[0] ?? null;
  };
  const launcher = findHost('gci-root');
  const panel = findHost('gci-inbox');
  const launcherRect = launcher?.getBoundingClientRect();

  const allButtons = deep('button, [role="button"]')
    .slice(0, 100)
    .map((element) => ({
      ...describe(element),
      type: element.getAttribute('type') ?? undefined,
      disabled: element.disabled || element.getAttribute('aria-disabled') === 'true',
      text: (element.textContent ?? '').trim().slice(0, 24) || undefined,
    }));

  return {
    adapter: document.documentElement.dataset.gciAdapter ?? null,
    title: document.title,
    url: location.href,
    candidates,
    sendButtons: buttons,
    allButtons,
    launcher: launcher
      ? {
          parent: launcher.parentElement
            ? `${launcher.parentElement.tagName.toLowerCase()}.${launcher.parentElement.className?.toString().slice(0, 50)}`
            : null,
          position: getComputedStyle(launcher).position,
          box: launcherRect
            ? [Math.round(launcherRect.x), Math.round(launcherRect.y), Math.round(launcherRect.width), Math.round(launcherRect.height)]
            : null,
        }
      : null,
    panel: panel ? getComputedStyle(panel.querySelector('.gci-panel') ?? panel).display : null,
  };
});

console.log(JSON.stringify(report, null, 2));
await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(0);
