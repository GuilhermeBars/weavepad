import { test, expect, content, documentText, append, connected } from './fixtures';

test('offline-merge', async ({ alice, bob, share }) => {
  await share();
  await append(alice, 'Shared beginning.');
  await expect.poll(() => documentText(bob)).toBe('Shared beginning.');
  await bob.context().setOffline(true);
  await expect(bob.getByRole('status')).toContainText('Offline');
  await append(bob, ' Bob wrote offline.');
  await append(alice, ' Alice wrote online.');
  await expect(content(alice)).not.toContainText('Bob wrote offline.');
  await expect(content(bob)).not.toContainText('Alice wrote online.');
  await bob.context().setOffline(false);
  await connected(bob);
  for (const page of [alice, bob]) {
    await expect(content(page)).toContainText('Alice wrote online.');
    await expect(content(page)).toContainText('Bob wrote offline.');
  }
  // Blur both editors so remote caret labels cannot affect the text comparison.
  await alice.getByRole('button', { name: 'History', exact: true }).focus();
  await bob.getByRole('button', { name: 'History', exact: true }).focus();
  await expect
    .poll(async () => (await documentText(alice)) === (await documentText(bob)))
    .toBe(true);
  await bob.reload();
  await connected(bob);
  await expect(content(bob)).toContainText('Bob wrote offline.');
  await expect(content(bob)).toContainText('Alice wrote online.');
});
