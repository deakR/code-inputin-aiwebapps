/**
 * Live check: loads the real gemini.google.com/app (signed out — the composer is
 * server rendered, so it is present) with the built extension installed and
 * reports what the extension actually sees there.
 *
 * Read-only in spirit: it types into the prompt box and inserts, but never
 * clicks Gemini's send button. Run with: node tools/live-check.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distArg = process.argv.slice(2).find((arg) => arg.startsWith('--dist='));
const extensionPath = path.join(root, distArg ? distArg.slice('--dist='.length) : 'dist');
const urlArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const url = urlArg ?? 'https://gemini.google.com/app';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gci-live-'));
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
const csp = [];
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error') {
    if (/Content Security Policy|Trusted Type|Refused to/i.test(text)) csp.push(text);
  }
});
page.on('pageerror', (error) => console.log('[page exception]', error.message));
/** What we are doing right now, so the extension requests can be grouped by phase. */
let phase = 'page load';
const extensionHits = [];
page.on('request', (request) => {
  if (request.url().startsWith('chrome-extension://')) {
    extensionHits.push({ name: request.url().split('/').pop() ?? '', phase });
  }
});
page.on('requestfailed', (request) => {
  if (request.url().startsWith('chrome-extension://')) {
    console.log('[extension request failed]', request.url().split('/').pop(), request.failure()?.errorText);
  }
});

console.log(`→ ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.waitForTimeout(8000);
await page.evaluate(() => localStorage.setItem('gci-debug', '1')).catch(() => {});
console.log('title:', await page.title(), '| final url:', page.url());

const report = await page.evaluate(() => {
  const selectors = [
    'rich-textarea .ql-editor',
    'rich-textarea [contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"]',
    'textarea',
  ];
  const describe = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 90),
      editable: el.isContentEditable,
      visible: el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true,
      box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      aria: el.getAttribute('aria-label'),
      text: (el.innerText ?? '').slice(0, 40),
    };
  };
  const bySelector = {};
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    bySelector[selector] = { count: nodes.length, first: nodes.slice(0, 3).map(describe) };
  }

  const inputArea = document.querySelector('.initial-input-area, .input-area, chat-window');
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], [data-testid]'))
    .map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        aria: button.getAttribute('aria-label'),
        testid: button.getAttribute('data-testid'),
        cls: (button.className || '').toString().slice(0, 60),
        icon: (button.querySelector('mat-icon, .material-symbols-outlined, .google-symbols')?.textContent ?? '').trim(),
        disabled: button.disabled || button.getAttribute('aria-disabled') === 'true',
        box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      };
    })
    .filter((b) => /send|submit/i.test(`${b.aria} ${b.testid} ${b.cls} ${b.icon}`));

  const host = document.getElementById('gci-root');
  const shadow = host?.shadowRoot ?? null;
  const launcher = shadow?.querySelector('.gci-launcher');
  // The panel lives in its own host: docked in the input box, or in the body.
  const panelHost = document.getElementById('gci-inbox');
  const panel =
    panelHost?.shadowRoot?.querySelector('.gci-panel') ?? shadow?.querySelector('.gci-panel');
  const launcherRect = launcher?.getBoundingClientRect();

  return {
    richTextArea: document.querySelectorAll('rich-textarea').length,
    inputAreaTag: inputArea ? `${inputArea.tagName.toLowerCase()}.${(inputArea.className || '').toString().slice(0, 60)}` : null,
    bySelector,
    sendButtons: buttons.slice(0, 6),
    host: host
      ? {
          shadow: Boolean(shadow),
          launcher: launcher
            ? {
                display: getComputedStyle(launcher).display,
                box: launcherRect ? [Math.round(launcherRect.x), Math.round(launcherRect.y), Math.round(launcherRect.width), Math.round(launcherRect.height)] : null,
                label: launcher.getAttribute('aria-label') ?? launcher.textContent?.trim().slice(0, 40),
              }
            : null,
          panelOpen: panel ? getComputedStyle(panel).display : null,
        }
      : null,
  };
});
console.log(JSON.stringify(report, null, 2));

// The composer's ancestry: which element is the rounded box, where the editor
// sits inside it, and whether anything would clip a panel placed in the flow.
const inputTree = await page.evaluate(() => {
  const box = document.querySelector('rich-textarea .ql-editor');
  if (!box) return null;
  const chain = [];
  let node = box;
  for (let depth = 0; node && depth < 7; depth += 1) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    chain.push({
      tag: node.tagName.toLowerCase(),
      cls: (node.className || '').toString().slice(0, 70),
      box: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      display: style.display,
      position: style.position,
      direction: style.flexDirection,
      background: style.backgroundColor,
      radius: style.borderRadius,
      border: style.border.slice(0, 44),
      shadow: style.boxShadow.slice(0, 44),
      overflow: style.overflow,
      minHeight: style.minHeight,
      maxHeight: style.maxHeight,
      padding: style.padding,
      children: Array.from(node.children)
        .map((child) => {
          const childRect = child.getBoundingClientRect();
          return `${child.tagName.toLowerCase()}.${(child.className || '').toString().slice(0, 30)} ${Math.round(childRect.width)}x${Math.round(childRect.height)}`;
        })
        .slice(0, 10),
    });
    node = node.parentElement;
  }
  return chain;
});
console.log('input area ancestry:', JSON.stringify(inputTree, null, 1));

// Open the panel from the page itself and insert, exactly like a user would.
// The panel normally docks *inside* the prompt box (#gci-inbox moves into
// `.text-input-field` and Gemini's text row hides), so panel locators are
// unscoped: Playwright's CSS engine pierces the shadow root.
const dockState = () =>
  page.evaluate(() => {
    const box = document.querySelector('.text-input-field');
    // Gemini drops the `single-line-format` class in multi-line mode, so find
    // the text row as the parent of the main area instead.
    const main = document.querySelector('.text-input-field-main-area');
    const row = main?.parentElement ?? null;
    const host = document.getElementById('gci-inbox');
    const rect = box?.getBoundingClientRect();
    // Our own layout inside the box: the code comes first and the control strip
    // sits underneath it, so the box's top-right corner — Gemini's own
    // expand/collapse button — has nothing of ours on top of it.
    const shadow = host?.shadowRoot ?? null;
    const panel = shadow?.querySelector('.gci-panel') ?? null;
    const code = shadow?.querySelector('.gci-editor')?.getBoundingClientRect() ?? null;
    const strip = shadow?.querySelector('.gci-header')?.getBoundingClientRect() ?? null;
    const cm = shadow?.querySelector('.cm-editor') ?? null;
    const scroller = shadow?.querySelector('.cm-scroller') ?? null;
    const footer = shadow?.querySelector('.gci-footer') ?? null;
    return {
      hostParent: host?.parentElement
        ? `${host.parentElement.tagName.toLowerCase()}.${(host.parentElement.className || '').toString().slice(0, 34)}`
        : null,
      insideBox: Boolean(box && host && box.contains(host)),
      rowDisplay: row ? getComputedStyle(row).display : null,
      boxHeight: rect ? Math.round(rect.height) : null,
      box: rect ? [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)] : null,
      panelOrder: strip && code ? (strip.top >= code.bottom - 1 ? 'code, then strip' : 'strip above code') : null,
      codeHeight: code ? Math.round(code.height) : null,
      stripHeight: strip ? Math.round(strip.height) : null,
      capVar: panel ? getComputedStyle(panel).getPropertyValue('--gci-dock-max').trim() || null : null,
      editorMaxHeight: cm ? getComputedStyle(cm).maxHeight : null,
      scrollerScrolls: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null,
      footerDisplay: footer ? getComputedStyle(footer).display : null,
      cmOverlays: shadow
        ? Array.from(shadow.querySelectorAll('.cm-panel, .cm-tooltip')).filter((n) => n.getClientRects().length > 0)
            .length
        : null,
      activeId: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}#${document.activeElement.id}` : 'none',
    };
  });

/** Where the pill sits relative to the box: small = hugging it, large = left behind. */
const pillGap = () =>
  page.evaluate(() => {
    const pill = document.getElementById('gci-root')?.shadowRoot?.querySelector('.gci-launcher');
    const box = document.querySelector('.text-input-field');
    if (!pill || !box || pill.hidden) return null;
    return Math.round(box.getBoundingClientRect().top - pill.getBoundingClientRect().bottom);
  });

const shots = path.join(os.tmpdir(), 'gci-live');
fs.mkdirSync(shots, { recursive: true });

const launcher = page.locator('#gci-root .gci-launcher');
if (await launcher.count()) {
  console.log('dock before opening:', JSON.stringify(await dockState()));
  console.log('pill gap before opening:', await pillGap());
  const pillBox = await launcher.boundingBox();
  console.log('launcher box:', JSON.stringify(pillBox));
  if (pillBox) {
    // Close-up of the chip and the top of the box — also a ready-made listing shot.
    await page.screenshot({
      path: path.join(shots, 'live-launcher.png'),
      clip: {
        x: Math.max(0, pillBox.x - 40),
        y: Math.max(0, pillBox.y - 40),
        width: pillBox.width + 80,
        height: pillBox.height + 120,
      },
    });
  }
  phase = 'panel open';
  await launcher.click();
  const panel = page.locator('.gci-panel');
  await panel.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  console.log('panel visible:', await panel.isVisible().catch(() => false));
  // The editor mounts from an async chunk, so the first frame can still be bare.
  await page.locator('.cm-content').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
  console.log('codemirror mounted:', await page.locator('.cm-content').count());
  console.log('dock while open:', JSON.stringify(await dockState()));
  await page.screenshot({ path: path.join(shots, 'live-docked.png') });
  await page.locator('.text-input-field').screenshot({ path: path.join(shots, 'live-docked-box.png') });

  // Auto-grow: a short snippet keeps the box small, a long one grows it and then
  // scrolls inside the editor at the height cap.
  await page.locator('.cm-content').click();
  await page.keyboard.type('def add(a, b):');
  await page.keyboard.press('Enter');
  await page.keyboard.type('return a + b');
  console.log('editor lines:', await page.locator('.cm-line').allTextContents());
  console.log('dock with 2 lines:', JSON.stringify(await dockState()));

  await page.keyboard.press('Enter');
  await page.keyboard.type(
    Array.from({ length: 11 }, (_, i) => `    value_${i} = compute(${i})`).join('\n'),
  );
  console.log('dock with 12 lines:', JSON.stringify(await dockState()));
  await page.locator('.text-input-field').screenshot({ path: path.join(shots, 'live-docked-tall-box.png') });

  await page.keyboard.type(
    '\n' + Array.from({ length: 30 }, (_, i) => `    more_${i} = compute(${i})`).join('\n'),
  );
  console.log('dock past the cap:', JSON.stringify(await dockState()));

  // Back to the two-line sample for the insert check (editor-only edit).
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('def add(a, b):');
  await page.keyboard.press('Enter');
  await page.keyboard.type('return a + b');

  await page.locator('.gci-btn-primary').click();
  await page.waitForTimeout(1500);
  console.log('toast:', await page.locator('.gci-toast').textContent().catch(() => 'none'));
  const inserted = await page.evaluate(() => {
    const box = document.querySelector('rich-textarea .ql-editor');
    return box ? (box.innerText ?? '').slice(0, 200) : '(no .ql-editor)';
  });
  console.log('prompt box now:', JSON.stringify(inserted));
  console.log('dock after insert:', JSON.stringify(await dockState()));
  console.log('pill gap after insert:', await pillGap());
  await page.screenshot({ path: path.join(shots, 'live-after-insert.png') });

  const structure = await page.evaluate(() => {
    const box = document.querySelector('rich-textarea .ql-editor');
    if (!box) return null;
    const describe = (node) => ({
      tag: node.tagName.toLowerCase(),
      cls: (node.className || '').toString().slice(0, 40),
      text: (node.textContent || '').slice(0, 60),
      children: Array.from(node.children).map((child) => child.tagName.toLowerCase()),
    });
    return { blocks: Array.from(box.children).map(describe), html: box.innerHTML.slice(0, 700) };
  });
  console.log('prompt box structure:', JSON.stringify(structure, null, 1));
  console.log('panel still open:', await panel.isVisible().catch(() => false));

  const debug = await page.locator('#gci-debug-out').textContent().catch(() => '(no debug output)');
  console.log('insert trace:\n' + debug);

  // Reopen, then Escape: the editor closes and the pill comes back to the box.
  await launcher.click();
  await page.locator('.cm-content').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {});
  console.log('reopened, code kept:', await page.locator('.cm-line').allTextContents());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  console.log('panel after Escape:', await panel.isVisible().catch(() => false));
  console.log('dock after Escape:', JSON.stringify(await dockState()));
  console.log('pill gap after Escape:', await pillGap());
}

/**
 * The extension's requests are files in `dist/`, so the local file size is a
 * good stand-in for what the browser had to read — grouped by what was happening.
 */
const distSizes = new Map();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else distSizes.set(entry.name, Math.round(fs.statSync(full).size / 102.4) / 10);
  }
};
walk(extensionPath);

const totals = {};
const seen = new Set();
for (const hit of extensionHits) {
  const key = `${hit.phase}|${hit.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const size = distSizes.get(hit.name) ?? 0;
  console.log(`extension request [${hit.phase}] ${hit.name} — ${size} kB`);
  totals[hit.phase] = Math.round(((totals[hit.phase] ?? 0) + size) * 10) / 10;
}
console.log('extension payload by phase (kB):', JSON.stringify(totals));
console.log('csp violations:', csp.length ? csp : 'none');

await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(0);
