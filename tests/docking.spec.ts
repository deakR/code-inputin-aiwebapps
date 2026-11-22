/**
 * Editor placement: docking is measured, per-site, and always reversible.
 */
import {
  test,
  expect,
  FIXTURES,
  launcher,
  panel,
  openEditor,
  openPopup,
  insertButton,
  writeSample,
} from './harness';

function panelBox(page: import('@playwright/test').Page): Promise<{
  docked: boolean;
  insideComposer: boolean;
  rowVisible: boolean;
} | null> {
  return page.evaluate(() => {
    const host = document.getElementById('gci-inbox');
    const prompt = document.getElementById('prompt-input') as HTMLElement | null;
    if (!host || !prompt) return null;
    const form = prompt.closest('form, fieldset, .composer-box');
    return {
      docked: Boolean(host.shadowRoot?.querySelector('.gci-panel.gci-docked')),
      insideComposer: Boolean(form?.contains(host)),
      rowVisible: getComputedStyle(prompt).display !== 'none',
    };
  });
}

test('auto-docks the editor into a generic composer and restores the text row', async ({ page }) => {
  await page.goto(`${FIXTURES}/chatgpt-mock.html`);
  await expect(launcher(page)).toBeVisible();
  await openEditor(page);
  await expect(panel(page)).toHaveClass(/gci-docked/);

  const docked = await panelBox(page);
  expect(docked).not.toBeNull();
  expect(docked!.insideComposer).toBe(true);
  expect(docked!.rowVisible).toBe(false);

  // Insert still works while the site's own text row is hidden.
  await writeSample(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();
  const restored = await panelBox(page);
  expect(restored!.rowVisible).toBe(true);
  expect(restored!.insideComposer).toBe(false);
});

test('a composer that cannot grow falls back to floating without clipping', async ({ page }) => {
  await page.goto(`${FIXTURES}/dock-reject-mock.html`);
  await expect(launcher(page)).toBeVisible();
  await openEditor(page);

  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).not.toHaveClass(/gci-docked/);
  const state = await panelBox(page);
  expect(state!.insideComposer).toBe(false);
  expect(state!.rowVisible).toBe(true);
});

test('the editor placement setting can force floating and force docking', async ({ context, page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  await expect(popup.locator('#editor-placement')).toHaveValue('auto');
  await popup.locator('#editor-placement').selectOption('floating');
  await page.bringToFront();

  await openEditor(page);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).not.toHaveClass(/gci-docked/);

  // Switching the preference while the editor is open re-places it.
  await popup.locator('#editor-placement').selectOption('docked');
  await page.bringToFront();
  await expect(panel(page)).toHaveClass(/gci-docked/);

  // And the choice survives a reload.
  await page.reload();
  await expect(launcher(page)).toBeVisible();
  await openEditor(page);
  await expect(panel(page)).toHaveClass(/gci-docked/);
});
