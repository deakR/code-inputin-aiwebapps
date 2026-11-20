/**
 * The popup is the extension's control panel: it lets users configure
 * language, launcher visibility/placement, shortcut, and see diagnostics.
 */
import { LANGUAGE_META } from '../src/composer/language-meta';
import { matchesShortcut } from '../src/shared/settings';
import {
  test,
  expect,
  FIXTURE_PAGE,
  openPopup,
  panel,
  launcher,
  launcherInComposer,
  launcherIsFloating,
} from './harness';

test('populates settings from stored configuration', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);

  // The settings form is populated from the stored settings.
  const language = popup.locator('#language');
  expect(await language.evaluate((el: HTMLSelectElement) => el.options.length)).toBe(LANGUAGE_META.length);
  await expect(language).toHaveValue('python');

  await expect(popup.locator('#launcher')).toBeChecked();
  await expect(popup.locator('#placement')).toHaveValue('auto');
  await expect(popup.locator('#shortcut')).toHaveValue('Ctrl+Shift+E');
  await expect(popup.locator('#version')).toContainText('v1.1.2');
});

test('changing floating button setting toggles launcher visibility', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  const launcherCheckbox = popup.locator('#launcher');
  await expect(launcherCheckbox).toBeChecked();

  // Turning off floating button hides the launcher immediately
  await launcherCheckbox.uncheck();
  await expect(launcher(page)).toBeHidden();

  // Reloading popup preserves the unchecked state
  await popup.reload();
  await expect(popup.locator('#launcher')).not.toBeChecked();

  // Turning it back on restores the launcher
  await popup.locator('#launcher').check();
  await expect(launcher(page)).toBeVisible();
});

test('changing placement moves the launcher between composer and corner', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();
  await expect.poll(() => launcherInComposer(page), { timeout: 3000 }).toBe(true);

  const popup = await openPopup(context);
  const placement = popup.locator('#placement');
  await expect(placement).toHaveValue('auto');

  // The fallback is one deterministic viewport corner, not a coordinate chase.
  await placement.selectOption('floating');
  await expect.poll(() => launcherIsFloating(page), { timeout: 3000 }).toBe(true);
  await expect.poll(() => launcherInComposer(page)).toBe(false);
  const floatingBox = await launcher(page).boundingBox();
  const viewport = page.viewportSize();
  expect(floatingBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(floatingBox!.x).toBeGreaterThan(viewport!.width - 100);
  expect(floatingBox!.y).toBeGreaterThan(viewport!.height - 100);

  // The choice is persisted.
  await popup.reload();
  await expect(popup.locator('#placement')).toHaveValue('floating');

  // Back to auto: the chip returns to the composer's action row.
  await popup.locator('#placement').selectOption('auto');
  await expect.poll(() => launcherInComposer(page), { timeout: 3000 }).toBe(true);
  await expect.poll(() => launcherIsFloating(page)).toBe(false);
});

test('changing shortcut setting configures the toggle hotkey and updates tooltip', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();

  // Launcher tooltip defaults to initial shortcut
  expect(await launcher(page).getAttribute('title')).toContain('Ctrl+Shift+E');
  expect(await launcher(page).getAttribute('aria-label')).toContain('Ctrl+Shift+E');

  const popup = await openPopup(context);
  const shortcutSelect = popup.locator('#shortcut');
  await expect(shortcutSelect).toHaveValue('Ctrl+Shift+E');

  // Change shortcut to Ctrl+Shift+K
  await shortcutSelect.selectOption('Ctrl+Shift+K');

  // Tooltip / aria-label updates immediately
  await expect.poll(async () => launcher(page).getAttribute('title')).toContain('Ctrl+Shift+K');
  await expect.poll(async () => launcher(page).getAttribute('aria-label')).toContain('Ctrl+Shift+K');

  // Verify persistence
  await popup.reload();
  await expect(popup.locator('#shortcut')).toHaveValue('Ctrl+Shift+K');

  // Bring focus back to the page
  await page.bringToFront();
  await page.locator('#prompt-editor').click();

  // Old shortcut (Ctrl+Shift+E) no longer toggles the panel
  await page.keyboard.press('Control+Shift+KeyE');
  await expect(panel(page)).toBeHidden();

  // New shortcut (Ctrl+Shift+K) opens the panel
  await page.keyboard.press('Control+Shift+KeyK');
  await expect(panel(page)).toBeVisible();

  // Pressing again closes it
  await page.keyboard.press('Control+Shift+KeyK');
  await expect(panel(page)).toBeHidden();

  // Change shortcut to Alt+Shift+C
  await shortcutSelect.selectOption('Alt+Shift+C');
  await expect.poll(async () => launcher(page).getAttribute('title')).toContain('Alt+Shift+C');

  // Focus prompt and test Alt+Shift+C hotkey
  await page.bringToFront();
  await page.locator('#prompt-editor').click();
  await page.keyboard.press('Alt+Shift+KeyC');
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press('Alt+Shift+KeyC');
  await expect(panel(page)).toBeHidden();
});

test('select dropdown options have readable contrast in dark mode', async ({ context }) => {
  const popup = await openPopup(context);
  await popup.emulateMedia({ colorScheme: 'dark' });

  for (const id of ['#language', '#placement', '#shortcut']) {
    const selectScheme = await popup.locator(id).evaluate((el) => {
      return getComputedStyle(el).colorScheme;
    });
    expect(selectScheme).toBe('dark');

    const optionStyle = await popup.locator(`${id} option`).first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(optionStyle.bg).toBe('rgb(31, 31, 31)');
    expect(optionStyle.color).toBe('rgb(232, 234, 237)');
  }
});

test('matchesShortcut handles key combos and modifiers accurately', () => {
  // Ctrl+Shift+E
  expect(matchesShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'e' }, 'Ctrl+Shift+E')).toBe(true);
  expect(matchesShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: true, key: 'E', code: 'KeyE' }, 'Ctrl+Shift+E')).toBe(true);
  expect(matchesShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'e' }, 'Ctrl+Shift+E')).toBe(false);

  // Alt+Shift+C
  expect(matchesShortcut({ ctrlKey: false, metaKey: false, altKey: true, shiftKey: true, key: 'c', code: 'KeyC' }, 'Alt+Shift+C')).toBe(true);
  expect(matchesShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: true, key: 'c' }, 'Alt+Shift+C')).toBe(false);

  // Space key
  expect(matchesShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: ' ', code: 'Space' }, 'Ctrl+Shift+Space')).toBe(true);

  // Empty or invalid shortcut
  expect(matchesShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'e' }, '')).toBe(false);
});
