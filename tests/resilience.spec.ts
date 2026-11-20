/**
 * Resilience tests: the extension must survive a host that rebuilds its
 * composer with different ids/classes, and the user must be able to repair a
 * page where a decoy wins the selector hints.
 */
import {
  test,
  expect,
  FIXTURES,
  launcher,
  panel,
  insertButton,
  openEditor,
  writeSample,
  openPopup,
} from './harness';

function host(page: import('@playwright/test').Page): Promise<{
  inActions: boolean;
  position: string | null;
} | null> {
  return page.evaluate(() => {
    const findHost = (root: Document | ShadowRoot): HTMLElement | null => {
      const direct = root.querySelector<HTMLElement>('#gci-root');
      if (direct) return direct;
      for (const element of Array.from(root.querySelectorAll('*'))) {
        const shadow = (element as HTMLElement).shadowRoot;
        if (shadow) {
          const found = findHost(shadow);
          if (found) return found;
        }
      }
      return null;
    };
    const element = findHost(document);
    if (!element) return null;
    return {
      inActions: Boolean(element.parentElement?.classList.contains('actions')),
      position: getComputedStyle(element).position,
    };
  });
}

function promptText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('#prompt-input, .mystery-editor');
    if (!editor) return '';
    return editor instanceof HTMLTextAreaElement
      ? editor.value
      : (editor.innerText ?? editor.textContent ?? '').replace(/\u00a0/g, ' ');
  });
}

test('re-attaches and keeps working after the composer is rebuilt with new ids and classes', async ({ page }) => {
  await page.goto(`${FIXTURES}/chaos-mock.html`);
  await expect(launcher(page)).toBeVisible();
  await expect.poll(async () => (await host(page))?.inActions, { timeout: 3000 }).toBe(true);

  await page.locator('#rebuild').click();

  // The old composer is gone. The new one has a different id, different class
  // names, no ProseMirror class and no role attribute — only a stable send
  // label and a visible editable. The scorer has to find it, and the chip has
  // to land in the new action row.
  await expect.poll(async () => (await host(page))?.inActions, { timeout: 5000 }).toBe(true);
  const placement = await host(page);
  expect(placement?.position).toBe('static');

  await openEditor(page);
  await writeSample(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();

  const text = await promptText(page);
  expect(text).toContain('def add(a, b):');
  expect(text).toContain('    return a + b');
});

test('user can pick the real prompt box and the choice survives a reload', async ({ context, page }) => {
  await page.goto(`${FIXTURES}/picker-mock.html`);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  await popup.locator('#pick').click();

  // The picker overlay is now on the page. Click the real composer, not the
  // decoy at the top of the page.
  await page.locator('#prompt-input').click();
  await expect(page.locator('.gci-toast')).toContainText('Prompt box saved');

  // The chip is now attached to the real action row.
  await expect.poll(async () => (await host(page))?.inActions, { timeout: 5000 }).toBe(true);

  // Insert goes into the real composer, not the decoy that won the hint list.
  await openEditor(page);
  await writeSample(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();
  expect(await promptText(page)).toContain('def add(a, b):');
  expect(await page.locator('#decoy').innerText()).toBe('');

  // Reload: the saved descriptor is loaded before detection, so the decoy
  // cannot take over again.
  await page.reload();
  await expect(launcher(page)).toBeVisible();
  await expect.poll(async () => (await host(page))?.inActions, { timeout: 5000 }).toBe(true);

  await openEditor(page);
  await writeSample(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();
  expect(await promptText(page)).toContain('def add(a, b):');
  expect(await page.locator('#decoy').innerText()).toBe('');
});

test('popup diagnostics reports the active adapter and prompt-box state', async ({ context, page }) => {
  await page.goto(`${FIXTURES}/chatgpt-mock.html`);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  await expect(popup.locator('#status-site')).toHaveText('ChatGPT');
  await expect(popup.locator('#status-input')).toContainText('Found');
  await expect(popup.locator('#status-launcher')).toHaveText('inline');
  await expect(popup.locator('#status-send')).toContainText(/send/i);
  expect(await popup.locator('#status-note').textContent()).toContain('Nothing leaves this browser');
});
