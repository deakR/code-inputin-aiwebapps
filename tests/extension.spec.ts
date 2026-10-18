/**
 * Integration tests: the built extension is loaded into Chrome and driven
 * against a behavioural mock of Gemini's prompt box.
 *
 *   npm run build && npm test
 */
import {
  test,
  expect,
  FIXTURES,
  launcher,
  panel,
  cmContent,
  cmLines,
  insertButton,
  sendButton,
  promptBox,
  promptLines,
  toast,
  geminiSend,
  openEditor,
  typeLines,
  writeSample,
  insertSample,
  clearPromptBox,
  composerBoxHeight,
  composerRow,
  panelIsDocked,
  launcherGap,
  visibleEditorOverlays,
} from './harness';

test('opens the editor inside the prompt box, which grows to hold it', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  const empty = await composerBoxHeight(page);

  await openEditor(page);

  // The panel host moved into the box, and Gemini's own text row stepped aside.
  expect(await panelIsDocked(page)).toBe(true);
  await expect(composerRow(page)).toBeHidden();
  const dockedHeight = await composerBoxHeight(page);
  expect(dockedHeight).toBeGreaterThan(empty + 40);

  // No chrome above the code: the controls live in one strip underneath it, the
  // way Gemini's own expanded composer keeps its buttons under the text. That is
  // what leaves the box's top-right corner free for Gemini's expand/collapse
  // button, which our own close button used to sit on top of.
  const placement = await page.evaluate(() => {
    const root = document.getElementById('gci-inbox')?.shadowRoot;
    const strip = root?.querySelector('.gci-header')?.getBoundingClientRect();
    const code = root?.querySelector('.gci-editor')?.getBoundingClientRect();
    const footer = root?.querySelector('.gci-footer');
    return {
      stripTop: strip ? Math.round(strip.top) : null,
      codeBottom: code ? Math.round(code.bottom) : null,
      footerDisplay: footer ? getComputedStyle(footer).display : null,
    };
  });
  expect(placement.stripTop).not.toBeNull();
  expect(placement.codeBottom).not.toBeNull();
  expect(placement.stripTop!).toBeGreaterThanOrEqual(placement.codeBottom! - 1);
  expect(placement.footerDisplay).toBe('none');

  await writeSample(page);

  // The dock must survive the mutation observer: while the editor is open,
  // Gemini's text row is hidden on purpose, so the prompt box fails a
  // visibility-based lookup and the dock would be lost if that weren't handled.
  await page.waitForTimeout(800);
  expect(await panelIsDocked(page)).toBe(true);
  await expect(composerRow(page)).toBeHidden();

  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();

  // The box went back to Gemini: its text row is visible again, the panel host
  // is out of it, and the code landed in the prompt box.
  await expect(composerRow(page)).toBeVisible();
  expect(await panelIsDocked(page)).toBe(false);
  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);
});

test('the docked editor grows with the code, up to the height setting', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  const shortHeight = await composerBoxHeight(page);

  await cmContent(page).click();
  await page.keyboard.insertText(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
  await page.waitForTimeout(120);
  const tallHeight = await composerBoxHeight(page);
  expect(tallHeight).toBeGreaterThan(shortHeight);

  // Past the setting the editor scrolls instead of growing further.
  const cap = await page.evaluate(() => {
    const root = document.getElementById('gci-inbox')?.shadowRoot;
    const editor = root?.querySelector('.cm-editor');
    return editor ? getComputedStyle(editor).maxHeight : null;
  });
  expect(cap).toBe('340px');
});

test('clicking away closes the editor without losing the code', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await writeSample(page);

  await page.locator('#conversation').click();
  await expect(panel(page)).toBeHidden();
  await expect(composerRow(page)).toBeVisible();
  expect(await panelIsDocked(page)).toBe(false);
  expect(await promptLines(page)).toEqual([]);
  // The pill comes back to the box, not to where the editor used to be.
  await expect.poll(() => launcherGap(page), { timeout: 3000 }).toBeLessThan(60);

  // Reopening brings the code back: nothing was thrown away.
  await openEditor(page);
  await expect(cmLines(page).first()).toHaveText('def add(a, b):');
  expect(await panelIsDocked(page)).toBe(true);
});

test('Gemini’s own collapse control closes the editor', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await expect(page.locator('.collapse-button')).toBeVisible();

  await page.locator('.collapse-button').click();
  await expect(panel(page)).toBeHidden();
  await expect(composerRow(page)).toBeVisible();
  expect(await panelIsDocked(page)).toBe(false);
});

test('keeps the pill on the box when the composer grows on its own', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await expect(launcher(page)).toBeVisible();
  await expect.poll(() => launcherGap(page), { timeout: 3000 }).toBeGreaterThan(0);
  const settled = await launcherGap(page);
  // Let any follow-up frame loop retire, so this exercises a re-layout that
  // arrives while the page is idle — which is what Gemini's animated layout does.
  await page.waitForTimeout(1200);
  expect(Math.abs((await launcherGap(page)) - settled)).toBeLessThanOrEqual(1);

  // A prompt box growing the way Gemini's does when a prompt runs to several
  // lines: no scroll, no resize event, just layout.
  await page.evaluate(() => {
    const box = document.getElementById('prompt-editor');
    if (!box) return;
    box.textContent = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Left alone the pill stays where the box used to start — which is how it
  // ended up over the conversation. It has to end up hugging the taller box.
  await expect
    .poll(async () => Math.abs((await launcherGap(page)) - settled), { timeout: 3000 })
    .toBeLessThanOrEqual(8);
  expect(await launcherGap(page)).toBeGreaterThan(0);
});

/* ── tests ─────────────────────────────────────────────────────────────── */

test('shows a launcher anchored above the prompt box', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await expect(launcher(page)).toBeVisible();

  const launcherBox = await launcher(page).boundingBox();
  const inputBox = await page.locator('.text-input-field').boundingBox();
  expect(launcherBox).not.toBeNull();
  expect(inputBox).not.toBeNull();
  expect(launcherBox!.y).toBeLessThan(inputBox!.y);
});

test('opens the editor with the keyboard shortcut', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  // The pill is the extension's "ready" signal (settings are loaded by then).
  await expect(launcher(page)).toBeVisible();
  await page.keyboard.press('Control+Shift+E');
  await expect(panel(page)).toBeVisible();
  await expect(cmContent(page)).toBeVisible();
  await page.keyboard.press('Control+Shift+E');
  await expect(panel(page)).toBeHidden();
});

test('auto-indents per language and inserts a fenced block', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await writeSample(page);

  // Python's indent service should have indented the second line by four spaces.
  const lines = await cmLines(page).allTextContents();
  expect(lines[0]).toBe('def add(a, b):');
  expect(lines[1]).toBe('    return a + b');

  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();

  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);

  // Gemini's send button must now be live.
  await expect(geminiSend(page)).toBeEnabled();
});

test('the inserted prompt can be sent and shows up in the conversation', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await insertSample(page);

  // Focus returns to the prompt box, so Enter sends.
  await page.keyboard.press('Enter');
  await expect(page.locator('#conversation .user-query')).toContainText('def add(a, b):');
  await expect(promptBox(page)).toHaveText('');
  await expect(geminiSend(page)).toBeDisabled();
});

test('uses the editor’s own paste pipeline when available', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await page.evaluate(() => {
    (window as unknown as { __gciMockHandlePaste: boolean }).__gciMockHandlePaste = true;
  });
  await insertSample(page);
  await expect(toast(page)).toContainText('(paste)');
  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);
});

test('inserts line by line when paste is not handled', async ({ page }) => {
  // The default mock ignores untrusted paste events, the way the real editor
  // does — so this is the ordinary path, not a special case.
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await page.evaluate(() => localStorage.setItem('gci-debug', '1'));
  await insertSample(page);
  await expect(toast(page)).toContainText('(execCommand-lines)');
  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);

  // The ignored paste leaves the caret on the editor element, and on the real
  // page inserting from there merged the first line with the second
  // ("```pythondef add(a, b):"). Every attempt must therefore start from a caret
  // that sits inside a block — which is what the extension's trace records.
  const trace = (await page.locator('#gci-debug-out').textContent()) ?? '';
  const attempts = trace
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { step: string; caretAtStart?: string; handled?: boolean })
    .filter((entry) => entry.step.startsWith('attempt '));
  expect(attempts.length).toBeGreaterThan(0);
  expect(attempts.map((entry) => entry.caretAtStart)).toEqual(attempts.map(() => 'inside-block'));
  expect(attempts.some((entry) => entry.handled)).toBe(true);
});

test('waits for a paste that lands late instead of inserting twice', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await page.evaluate(() => {
    (window as unknown as { __gciMockAsyncPaste: boolean }).__gciMockAsyncPaste = true;
  });
  await insertSample(page);

  // Verified, so the toast names the strategy rather than asking for a check.
  await expect(toast(page)).toContainText('(paste)');
  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);
});

test('moves on when the paste is swallowed after all', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await page.evaluate(() => {
    (window as unknown as { __gciMockSwallowPaste: boolean }).__gciMockSwallowPaste = true;
  });
  await insertSample(page);

  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);
});

test('never lets keystrokes from the editor reach the page', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);

  await page.evaluate(() => {
    (window as unknown as { __gciResetLeaks: () => void }).__gciResetLeaks();
  });
  await typeLines(page, ['x = 1', 'y = 2']);

  const leaks = await page.evaluate(
    () => (window as unknown as { __gciPageKeyEvents: number }).__gciPageKeyEvents,
  );
  expect(leaks).toBe(0);
});

test('does not insert the same code twice', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await insertSample(page);

  await openEditor(page);
  await insertButton(page).click();
  await expect(toast(page)).toContainText('already in the prompt box');

  const fenced = await promptBox(page).innerText();
  expect(fenced.match(/```python/g)?.length).toBe(1);
});

test('inserts again after the prompt box is emptied', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await insertSample(page);
  await clearPromptBox(page);

  await openEditor(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();

  expect(await promptLines(page)).toEqual(['```python', 'def add(a, b):', '    return a + b', '```']);
});

test('works under a strict CSP with Trusted Types enforced', async ({ page }) => {
  const violations: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Trusted Type|Refused to/i.test(text)) violations.push(text);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`${FIXTURES}/gemini-mock-csp.html`);

  // The fixture itself must have loaded under its own policy.
  expect(
    await page.evaluate(
      () => typeof (window as unknown as { __gciResetLeaks?: () => void }).__gciResetLeaks,
    ),
  ).toBe('function');

  await openEditor(page);

  // This fixture has no `.text-input-field` box around the prompt box, so the
  // panel has to fall back to the floating overlay instead of docking.
  expect(await panelIsDocked(page)).toBe(false);

  // Our stylesheet is applied, not silently dropped.
  const panelBackground = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(panelBackground).not.toBe('rgba(0, 0, 0, 0)');

  // CodeMirror's own styles are mounted too.
  const font = await cmContent(page).evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font.toLowerCase()).toContain('monospace');

  await writeSample(page);
  await insertButton(page).click();
  await expect(panel(page)).toBeHidden();

  const prompt = await promptBox(page).innerText();
  expect(prompt).toContain('    return a + b');

  expect(violations).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('the send button inserts and sends in one go', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await writeSample(page);
  await sendButton(page).click();

  await expect(page.locator('#conversation .user-query')).toContainText('def add(a, b):');
  await expect(panel(page)).toBeHidden();
});

test('escape closes the editor and gives the box back to Gemini', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await page.locator('.cm-content').click();

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(composerRow(page)).toBeVisible();
  expect(await panelIsDocked(page)).toBe(false);
  await expect(launcher(page)).toBeVisible();
});

test('a hidden editor tooltip does not swallow escape', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await page.locator('.cm-content').click();

  // CodeMirror keeps the autocomplete tooltip node in the DOM once it has been
  // used, hidden — on the real page that made Escape stop working.
  await page.evaluate(() => {
    const shadow = document.getElementById('gci-inbox')?.shadowRoot;
    const tooltip = document.createElement('div');
    tooltip.className = 'cm-tooltip cm-tooltip-autocomplete';
    tooltip.textContent = 'hidden tooltip';
    tooltip.style.display = 'none';
    shadow?.appendChild(tooltip);
  });
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  // …while a tooltip that is really on screen still takes the key first.
  await launcher(page).click();
  await page.locator('.cm-content').click();
  await page.evaluate(() => {
    const shadow = document.getElementById('gci-inbox')?.shadowRoot;
    const tooltip = document.createElement('div');
    tooltip.className = 'cm-tooltip';
    tooltip.textContent = 'open tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.top = '0';
    tooltip.style.left = '0';
    shadow?.appendChild(tooltip);
  });
  await page.keyboard.press('Escape');
  expect(await panel(page).isVisible()).toBe(true);
});

test('escape dismisses the completion popup before the editor', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await openEditor(page);
  await page.locator('.cm-content').click();
  await page.keyboard.type('ret');
  await expect.poll(() => visibleEditorOverlays(page)).toBeGreaterThan(0);

  // The popup takes the first Escape…
  await page.keyboard.press('Escape');
  await expect.poll(() => visibleEditorOverlays(page)).toBe(0);
  expect(await panel(page).isVisible()).toBe(true);

  // …the editor the second, and reopening must not bring the popup back.
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await openEditor(page);
  await page.waitForTimeout(300);
  expect(await visibleEditorOverlays(page)).toBe(0);
});

test('docked panel controls and dropdown options match Gemini dark theme styling', async ({ page }) => {
  await page.goto(`${FIXTURES}/gemini-mock.html`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await openEditor(page);

  const panelLocator = panel(page);
  await expect(panelLocator).toHaveClass(/gci-dark/);

  const selectColor = await page.locator('.gci-select').evaluate((el) => {
    return getComputedStyle(el).colorScheme;
  });
  expect(selectColor).toBe('dark');

  const optionColor = await page.locator('.gci-select option').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color };
  });
  expect(optionColor.bg).toBe('rgb(31, 31, 31)');
  expect(optionColor.color).toBe('rgb(232, 234, 237)');

  const uiFont = await panelLocator.evaluate((el) => {
    return getComputedStyle(el).fontFamily;
  });
  expect(uiFont.toLowerCase()).toContain('google sans');
});
