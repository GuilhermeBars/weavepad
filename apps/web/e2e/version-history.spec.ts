import { test, expect, content, documentText, append } from './fixtures';

test('version-history', async ({ alice, bob, share }) => {
  await share();
  await append(alice, 'The original snapshot.');
  await expect.poll(() => documentText(bob)).toBe('The original snapshot.');
  await alice.getByRole('button', { name: 'History', exact: true }).click();
  await alice.getByLabel('Version name').fill('First draft');
  await alice.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(alice.getByText('Version saved.', { exact: true })).toBeVisible();
  await append(bob, ' A later addition.');
  await expect(content(alice)).toContainText('A later addition.');
  await bob.getByRole('button', { name: 'History', exact: true }).focus();
  await alice.getByRole('button', { name: /First draft/ }).click();
  await expect(alice.locator('.diff-content ins')).toContainText('A later addition.');
  await alice.getByRole('button', { name: 'Restore this version', exact: true }).click();
  await alice
    .getByRole('dialog')
    .getByRole('button', { name: 'Restore version', exact: true })
    .click();
  await expect(alice.getByText('Version restored for everyone.', { exact: true })).toBeVisible();
  await expect.poll(() => documentText(alice)).toBe('The original snapshot.');
  await expect.poll(() => documentText(bob)).toBe('The original snapshot.');
});
