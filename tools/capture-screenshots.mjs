import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const docsImages = path.join(root, 'docs', 'images');
const port = 5190;

await mkdir(docsImages, { recursive: true });

// 1. Start test fixture server
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1');

console.log(`[screenshot] Server running on http://127.0.0.1:${port}`);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gci-ss-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 860 },
  colorScheme: 'dark',
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/fixtures/gemini-mock.html`);
  await page.waitForTimeout(600);

  // 1. Capture launcher chip with context above
  const boxRect = await page.locator('.text-input-field').boundingBox();
  if (boxRect) {
    await page.screenshot({
      path: path.join(docsImages, 'gemini-launcher-chip.png'),
      clip: {
        x: Math.max(0, boxRect.x - 20),
        y: Math.max(0, boxRect.y - 45),
        width: boxRect.width + 40,
        height: boxRect.height + 55,
      },
    });
    console.log('[screenshot] Saved gemini-launcher-chip.png');
  }

  // 2. Open editor and type sample code
  const launcher = page.locator('#gci-root .gci-launcher');
  await launcher.click();
  await page.waitForTimeout(600);

  const cmContent = page.locator('.cm-content');
  await cmContent.click();
  const sampleCode = `def fibonacci(n: int) -> list[int]:
    """Generate the first n Fibonacci numbers."""
    if n <= 0:
        return []
    sequence = [0, 1]
    while len(sequence) < n:
        sequence.append(sequence[-1] + sequence[-2])
    return sequence[:n]`;
  await page.keyboard.insertText(sampleCode);
  await page.waitForTimeout(500);

  const editorBox = await page.locator('.text-input-field').boundingBox();
  if (editorBox) {
    await page.screenshot({
      path: path.join(docsImages, 'gemini-code-editor-docked.png'),
      clip: {
        x: Math.max(0, editorBox.x - 10),
        y: Math.max(0, editorBox.y - 10),
        width: editorBox.width + 20,
        height: editorBox.height + 20,
      },
    });
    console.log('[screenshot] Saved gemini-code-editor-docked.png');
  }

  // Also capture in Light Theme for README comparison
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(400);
  if (editorBox) {
    await page.screenshot({
      path: path.join(docsImages, 'gemini-code-editor-light.png'),
      clip: {
        x: Math.max(0, editorBox.x - 10),
        y: Math.max(0, editorBox.y - 10),
        width: editorBox.width + 20,
        height: editorBox.height + 20,
      },
    });
    console.log('[screenshot] Saved gemini-code-editor-light.png');
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);

  const inputArea = page.locator('.text-input-field');
  const langSelect = page.locator('#gci-inbox').locator('.gci-select');
  await langSelect.focus();
  await inputArea.screenshot({ path: path.join(docsImages, 'gemini-code-editor-dropdown.png') });
  console.log('[screenshot] Saved gemini-code-editor-dropdown.png');

  // 4. Capture Extension Popup
  // Find extension id
  const internals = await context.newPage();
  await internals.goto('chrome://extensions-internals');
  const dump = await internals.locator('body').innerText();
  await internals.close();

  let extId = '';
  for (const chunk of dump.split('"id"')) {
    const id = chunk.match(/^\s*:\s*"([a-p]{32})"/)?.[1];
    if (id && chunk.slice(0, 500).includes('Gemini Code Input')) {
      extId = id;
      break;
    }
  }

  if (extId) {
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popupPage.waitForTimeout(500);
    const bodyBox = await popupPage.locator('body').boundingBox();
    if (bodyBox) {
      await popupPage.screenshot({
        path: path.join(docsImages, 'extension-popup.png'),
        clip: {
          x: Math.round(bodyBox.x),
          y: Math.round(bodyBox.y),
          width: Math.round(bodyBox.width),
          height: Math.round(bodyBox.height),
        },
      });
    } else {
      await popupPage.screenshot({ path: path.join(docsImages, 'extension-popup.png') });
    }
    console.log('[screenshot] Saved extension-popup.png');
    await popupPage.close();
  }

} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  server.close();
}

console.log('[screenshot] All screenshots captured successfully.');
