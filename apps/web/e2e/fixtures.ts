import { randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';

type Collaborators = {
  alice: Page;
  bob: Page;
  share: (role?: 'editor' | 'viewer') => Promise<string>;
};

export const test = base.extend<Collaborators>({
  alice: async ({ browser }, use) => {
    const context = await browser.newContext();
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
  bob: async ({ browser }, use) => {
    const context = await browser.newContext();
    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
  share: async ({ alice, bob }, use) => {
    let documentId: string | undefined;
    const suffix = randomUUID();
    await login(bob, 'Bob', `bob-${suffix}@example.test`);
    await login(alice, 'Alice', `alice-${suffix}@example.test`);
    try {
      await use(async (role = 'editor') => {
        await alice.getByRole('button', { name: 'New document' }).click();
        await alice.waitForURL(/\/d\/[\da-f-]+$/);
        documentId = alice.url().split('/').at(-1)!;
        await connected(alice);
        await alice.getByRole('button', { name: 'Share', exact: true }).click();
        const dialog = alice.getByRole('dialog', { name: 'Share document' });
        await dialog.getByLabel('Email address').fill(`bob-${suffix}@example.test`);
        await dialog.getByRole('combobox', { name: /Permission/ }).selectOption(role);
        await dialog.getByRole('button', { name: 'Invite', exact: true }).click();
        await expect(dialog.getByLabel(`Role for bob-${suffix}@example.test`)).toHaveValue(role);
        await alice.keyboard.press('Escape');
        await bob.goto(`/d/${documentId}`);
        await connected(bob);
        return documentId;
      });
    } finally {
      await bob.context().setOffline(false);
      if (documentId) {
        const response = await alice.request.delete(`/api/docs/${documentId}`, {
          headers: { Origin: new URL(alice.url()).origin },
        });
        expect(response.status()).toBe(200);
      }
    }
  },
});

async function login(page: Page, name: string, email: string) {
  await page.goto('/login');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await page.waitForURL('/');
}

export const content = (page: Page) => page.getByRole('textbox', { name: 'Document content' });

export async function documentText(page: Page) {
  return content(page).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.collaboration-carets__caret').forEach((caret) => caret.remove());
    return copy.textContent;
  });
}

export async function connected(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Connected' })).toBeVisible();
}

export async function append(page: Page, text: string) {
  await content(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

export { expect };
