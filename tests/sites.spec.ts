/**
 * Adapter matrix: the same built extension against ChatGPT-, Claude-,
 * DeepSeek-, Copilot- and Perplexity-shaped composers.
 *
 * Each fixture uses a different editing surface (ProseMirror, textarea, and a
 * textarea inside an open shadow root), so a regression in any of the insert
 * strategies or the inline launcher shows up here.
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
  cmContent,
} from './harness';

const SITES = [
  { name: 'ChatGPT', file: 'chatgpt-mock.html', adapter: 'chatgpt' },
  { name: 'Claude', file: 'claude-mock.html', adapter: 'claude' },
  { name: 'DeepSeek', file: 'deepseek-mock.html', adapter: 'deepseek' },
  { name: 'Copilot', file: 'copilot-mock.html', adapter: 'copilot' },
  { name: 'Perplexity', file: 'perplexity-mock.html', adapter: 'perplexity' },
] as const;

function promptText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const find = (root: Document | ShadowRoot): HTMLElement | null => {
      const direct = root.querySelector<HTMLElement>('#prompt-input');
      if (direct) return direct;
      for (const element of Array.from(root.querySelectorAll('*'))) {
        const shadow = (element as HTMLElement).shadowRoot;
        if (shadow) {
          const found = find(shadow);
          if (found) return found;
        }
      }
      return null;
    };
    const editor = find(document);
    if (!editor) return '';
    return editor instanceof HTMLTextAreaElement
      ? editor.value
      : (editor.innerText ?? editor.textContent ?? '').replace(/\u00a0/g, ' ');
  });
}

function promptSendDisabled(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const find = (root: Document | ShadowRoot): HTMLButtonElement | null => {
      const direct = root.querySelector<HTMLButtonElement>('#send-button');
      if (direct) return direct;
      for (const element of Array.from(root.querySelectorAll('*'))) {
        const shadow = (element as HTMLElement).shadowRoot;
        if (shadow) {
          const found = find(shadow);
          if (found) return found;
        }
      }
      return null;
    };
    return find(document)?.disabled ?? true;
  });
}

function launcherParentClass(page: import('@playwright/test').Page): Promise<string | null> {
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
    return findHost(document)?.parentElement?.className?.toString() ?? null;
  });
}

function launcherSlot(page: import('@playwright/test').Page): Promise<boolean> {
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
    const host = findHost(document);
    return Boolean(host?.parentElement?.classList.contains('actions'));
  });
}

for (const site of SITES) {
  test(`${site.name}: inline launcher, adapter detection and fenced insert`, async ({ page }) => {
    await page.goto(`${FIXTURES}/${site.file}`);
    await expect(launcher(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.gciAdapter)).toBe(site.adapter);
    await expect.poll(() => launcherSlot(page), { timeout: 3000 }).toBe(true);
    if (site.adapter === 'chatgpt') {
      // The left tool row is preferred when it has room for the chip.
      await expect.poll(() => launcherParentClass(page)).toContain('attach-row');
    }

    // The launcher is the host's own action-row child, not a viewport overlay.
    const placement = await page.evaluate(() => {
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
      const host = findHost(document);
      const style = host ? getComputedStyle(host) : null;
      return {
        position: style?.position ?? null,
        parentClass: host?.parentElement?.className ?? null,
      };
    });
    expect(placement.position).toBe('static');
    expect(placement.parentClass).toContain('actions');

    await openEditor(page);
    await expect(panel(page)).toBeVisible();
    // Every mocked composer is a vertical box with a text row of its own, so
    // Auto docks there. Copilot is the shadow-DOM fallback and stays floating.
    if (site.adapter === 'copilot') {
      await expect(page.locator('.gci-panel')).not.toHaveClass(/gci-docked/);
    } else {
      await expect(page.locator('.gci-panel')).toHaveClass(/gci-docked/);
    }
    // Opening the editor is not an insert: the prompt box must stay untouched.
    expect(await promptText(page)).toBe('');

    await cmContent(page).click();
    await writeSample(page);
    await insertButton(page).click();
    await expect(panel(page)).toBeHidden();

    const text = await promptText(page);
    expect(text).toContain('```python');
    expect(text).toContain('def add(a, b):');
    expect(text).toContain('    return a + b');
    expect(text).toContain('```');
    expect(await promptSendDisabled(page)).toBe(false);

    // The chip comes back into the same action row after the panel closes.
    await expect.poll(() => launcherSlot(page), { timeout: 3000 }).toBe(true);
  });

  test(`${site.name}: insert can be sent through the site's own button`, async ({ page }) => {
    await page.goto(`${FIXTURES}/${site.file}`);
    await openEditor(page);
    await writeSample(page);
    await page.locator('.gci-btn', { hasText: /^Send$/ }).click();
    await expect(page.locator('#conversation .user-query')).toContainText('def add(a, b):');
    await expect(panel(page)).toBeHidden();
  });
}
