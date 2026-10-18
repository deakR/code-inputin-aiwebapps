/**
 * The popup is the extension's control panel: it reports whether it can reach
 * a Gemini tab and edits the settings the content script reacts to.
 */
import { LANGUAGE_META } from '../src/composer/language-meta';
import { test, expect, FIXTURE_PAGE, openPopup, openEditor, cmContent, panel, launcher } from './harness';

test('reports the Gemini tab as ready', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  await expect(popup.locator('#status')).toContainText('Prompt box found');
  await expect(popup.locator('#dot')).toHaveClass(/on/);
  await expect(popup.locator('#diag')).toContainText('matched:');
  // An empty prompt box means a disabled send button, and the popup says so.
  await expect(popup.locator('#diag')).toContainText('send: disabled: Send message');

  // With text in the box it becomes a usable send button.
  await page.evaluate(() => {
    const box = document.getElementById('prompt-editor');
    if (!box) return;
    box.textContent = 'hello';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await popup.reload();
  await expect(popup.locator('#diag')).toContainText('send: Send message');

  // The settings form is populated from the stored settings.
  const language = popup.locator('#language');
  expect(await language.evaluate((el: HTMLSelectElement) => el.options.length)).toBe(LANGUAGE_META.length);
  await expect(language).toHaveValue('python');
  await expect(popup.locator('#fence')).toBeChecked();
  await expect(popup.locator('#launcher')).toBeChecked();
  await expect(popup.locator('#height-value')).toHaveText('340 px');
});

test('opens the code editor in the Gemini tab', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  const open = popup.locator('#open');
  await expect(open).toBeVisible();
  await expect(open).toHaveText('Open the code editor');
  await open.click();

  await expect(panel(page)).toBeVisible();
  await expect(cmContent(page)).toBeVisible();
});

test('settings changed in the popup reach the editor immediately', async ({ context, page }) => {
  await page.goto(FIXTURE_PAGE);
  await expect(launcher(page)).toBeVisible();

  const popup = await openPopup(context);
  const wrap = popup.locator('#wrap');
  await expect(wrap).not.toBeChecked();

  // Open the panel from the page itself: the popup's own button closes the
  // popup, and this test keeps talking to it afterwards.
  await openEditor(page);
  const wrapped = () => cmContent(page).evaluate((el) => el.classList.contains('cm-lineWrapping'));
  expect(await wrapped()).toBe(false);

  // "Wrap long lines" is a CodeMirror compartment: flipping it in the popup
  // must reconfigure the live editor without reopening it.
  await wrap.click();
  await expect.poll(wrapped).toBe(true);

  // …and it survives a reload of the popup (it is actually persisted).
  await popup.reload();
  await expect(popup.locator('#wrap')).toBeChecked();
  // The popup also reports where the editor ended up: docked in the box here.
  await expect(popup.locator('#diag')).toContainText('docked in the prompt box');
});

test('says so when there is no Gemini tab to talk to', async ({ context }) => {
  const popup = await openPopup(context);
  await expect(popup.locator('#status')).toContainText('No Gemini tab found');
  await expect(popup.locator('#dot')).toHaveClass(/off/);
  await expect(popup.locator('#open')).toBeHidden();
});
