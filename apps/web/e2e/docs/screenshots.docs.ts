import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connected, content, documentText } from '../fixtures';

const output = resolve(__dirname, '../../../../docs/screenshots');
const title = 'Launch notes · Product spec';
const brief = `<h2>A calmer product launch</h2>
<p>Give every release a shared checklist.</p>
<blockquote><p>One place to plan, review, and ship together.</p></blockquote>
<h2>First release</h2>
<ul><li><p>Draft a launch brief with the team.</p></li><li><p>Invite reviewers before publishing.</p></li><li><p>Save a version when the scope is agreed.</p></li></ul>
<pre><code>release.status = "ready_for_review";</code></pre>
<p><strong>Open question:</strong> Who signs off on the final checklist?</p>`;

async function login(page: Page, name: string) {
  await page.goto('/login');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email address').fill(`${name.toLowerCase()}@example.test`);
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.waitForURL('/');
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  return page.screenshot({ path: join(output, name), animations: 'disabled' });
}

test('capture real product walkthrough', async ({ browser }) => {
  await mkdir(output, { recursive: true });
  const options = { viewport: { width: 1440, height: 900 }, locale: 'en-US' };
  const anaContext = await browser.newContext(options);
  const brunoContext = await browser.newContext(options);
  const ana = await anaContext.newPage();
  const bruno = await brunoContext.newPage();
  let id: string | undefined;
  try {
    await login(bruno, 'Bruno');
    await login(ana, 'Ana');
    await ana.getByRole('button', { name: 'New document' }).click();
    await ana.waitForURL(/\/d\/[\da-f-]+$/);
    id = ana.url().split('/').at(-1)!;
    await connected(ana);
    await ana.getByLabel('Document title', { exact: true }).fill(title);
    const saved = ana.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/docs/${id}`) && response.request().method() === 'PATCH',
    );
    await ana.getByRole('button', { name: 'Save document title' }).click();
    expect((await saved).ok()).toBe(true);
    await content(ana).click();
    // A real rich-text paste goes through TipTap's input pipeline and Yjs sync.
    // No app state, network responses, presence, or rendered UI is mocked.
    await content(ana).evaluate((element, html) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', html);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
    }, brief);
    await expect(content(ana).locator('pre')).toContainText('ready_for_review');
    await ana.getByRole('button', { name: 'Share', exact: true }).click();
    const dialog = ana.getByRole('dialog', { name: 'Share document' });
    await dialog.getByLabel('Email address').fill('bruno@example.test');
    await dialog.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(dialog.getByLabel('Role for bruno@example.test')).toHaveValue('editor');
    await ana.keyboard.press('Escape');
    await bruno.goto(`/d/${id}`);
    await connected(bruno);
    await expect.poll(() => documentText(bruno)).toBe(await documentText(ana));

    await content(ana).getByText('Give every release a shared checklist.', { exact: true }).click();
    await ana.keyboard.press('End');
    await content(bruno).getByText('Invite reviewers before publishing.', { exact: true }).click();
    await bruno.keyboard.press('End');
    for (const [page, remote] of [
      [ana, 'Bruno'],
      [bruno, 'Ana'],
    ] as const) {
      await expect(
        page.locator('.collaboration-carets__label').filter({ hasText: remote }),
      ).toBeVisible();
      const people = page.getByLabel('People in this document');
      await expect(people.getByLabel('Ana', { exact: true })).toBeVisible();
      await expect(people.getByLabel('Bruno', { exact: true })).toBeVisible();
    }
    const left = await capture(ana, 'collaboration-ana.png');
    const right = await capture(bruno, 'collaboration-bruno.png');
    const composite = await anaContext.newPage();
    // Only the presentation canvas is composed; both images are unmodified captures.
    await composite.setContent(`<html><head><style>
      *{box-sizing:border-box}body{margin:0;background:#eeedf4;font:16px Arial;color:#282830;padding:28px;min-height:100vh;display:flex;flex-direction:column;justify-content:center}
      h1{font-size:25px;margin:0 0 8px}p{margin:0 0 24px;color:#73737e}
      main{display:grid;grid-template-columns:1fr 1fr;gap:20px}
      figure{margin:0;min-width:0}figcaption{margin:0 0 10px;font-weight:bold}
      img{display:block;width:100%;border:1px solid #dcdbe4;border-radius:10px}
      </style></head><body><h1>One document. Two perspectives.</h1>
      <p>Live collaboration in Weavepad · two independent browser sessions</p><main>
      <figure><figcaption>Ana · Owner</figcaption><img src="data:image/png;base64,${left.toString('base64')}"></figure>
      <figure><figcaption>Bruno · Editor</figcaption><img src="data:image/png;base64,${right.toString('base64')}"></figure>
      </main></body></html>`);
    await composite
      .locator('img')
      .evaluateAll((images) =>
        Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
      );
    await capture(composite, 'collaboration-side-by-side.png');
    await composite.close();

    await ana.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(dialog.getByLabel('Role for ana@example.test')).toHaveValue('owner');
    await capture(ana, 'share-dialog.png');
    await ana.keyboard.press('Escape');
    await ana.getByRole('button', { name: 'History', exact: true }).click();
    await ana.getByLabel('Version name').fill('Scope agreed');
    await ana.getByRole('button', { name: 'Save version', exact: true }).click();
    await expect(ana.getByText('Version saved.', { exact: true })).toBeVisible();
    await content(bruno)
      .getByText('Give every release a shared checklist.', { exact: true })
      .click();
    await bruno.keyboard.press('Home');
    await bruno.keyboard.press('Shift+End');
    await bruno.keyboard.insertText('Give every release a clear owner and a shared checklist.');
    await expect(content(ana)).toContainText('a clear owner');
    await ana.getByRole('button', { name: /Scope agreed/ }).click();
    await expect(ana.locator('.diff-content ins')).toContainText('clear owner');
    await capture(ana, 'history-diff.png');
    await ana.getByRole('button', { name: 'Close history' }).click();

    await brunoContext.setOffline(true);
    await expect(bruno.getByRole('status')).toContainText('Offline');
    await content(bruno).getByText('Open question:', { exact: true }).click();
    await bruno.keyboard.press('End');
    await bruno.keyboard.insertText(' Ana will review the checklist.');
    await expect(content(ana)).not.toContainText('Ana will review');
    await capture(bruno, 'offline.png');
    await brunoContext.setOffline(false);
    await connected(bruno);
    await expect(content(ana)).toContainText('Ana will review');

    await ana.getByRole('link', { name: 'Back to workspace' }).click();
    await expect(ana.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    await capture(ana, 'dashboard.png');
  } finally {
    await brunoContext.setOffline(false);
    if (id) {
      const response = await ana.request.delete(`/api/docs/${id}`, {
        headers: { Origin: 'http://127.0.0.1:3310' },
      });
      expect(response.ok()).toBe(true);
    }
    await brunoContext.close();
    await anaContext.close();
  }
});
