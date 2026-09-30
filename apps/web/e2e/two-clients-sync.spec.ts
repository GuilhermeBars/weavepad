import { test, expect, content, documentText, append } from './fixtures';

test('two-clients-sync', async ({ alice, bob, share }) => {
  await share();
  await append(alice, 'An idea from Alice.');
  await expect.poll(() => documentText(bob)).toBe('An idea from Alice.');
  await append(bob, ' A reply from Bob.');
  for (const page of [alice, bob]) {
    // Assert both edits and both authenticated participants.
    await expect(content(page)).toContainText('An idea from Alice.');
    await expect(content(page)).toContainText(' A reply from Bob.');
    const people = page.getByLabel('People in this document');
    await expect(people.getByLabel('Alice', { exact: true })).toBeVisible();
    await expect(people.getByLabel('Bob', { exact: true })).toBeVisible();
  }
  await expect(
    alice.locator('.collaboration-carets__label').filter({ hasText: 'Bob' }),
  ).toBeVisible();
});
