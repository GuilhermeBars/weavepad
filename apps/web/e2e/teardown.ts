import { access, writeFile } from 'node:fs/promises';

export default async function teardown() {
  const file = process.env.E2E_SHUTDOWN_FILE!;
  // Playwright force-kills process trees on Windows. Request a flush first.
  await writeFile(file, 'shutdown');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      await access(file);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('E2E services did not finish graceful shutdown');
}
