import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as sync from 'y-protocols/sync';
import { test, expect, content, documentText, append, connected } from './fixtures';

test('viewer-readonly', async ({ alice, bob, share }) => {
  const id = await share('viewer');
  await append(alice, 'Only the owner can change this.');
  await expect.poll(() => documentText(bob)).toBe('Only the owner can change this.');
  await expect(content(bob)).toHaveAttribute('contenteditable', 'false');
  await content(bob).click();
  await bob.keyboard.type('Forbidden typing');
  await expect(content(bob)).not.toContainText('Forbidden typing');

  const tokenResponse = await bob.request.get(`/api/docs/${id}/token`);
  expect(tokenResponse.ok()).toBe(true);
  const { token } = (await tokenResponse.json()) as { token: string };
  const malicious = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, 'Forbidden protocol edit');
  paragraph.insert(0, [text]);
  malicious.getXmlFragment('default').insert(0, [paragraph]);
  const frame = (write: (encoder: encoding.Encoder) => void) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    write(encoder);
    return Array.from(encoding.toUint8Array(encoder));
  };
  const empty = new Y.Doc();
  try {
    const frames = [
      frame((encoder) => sync.writeSyncStep2(encoder, malicious)),
      frame((encoder) => sync.writeUpdate(encoder, Y.encodeStateAsUpdate(malicious))),
      frame((encoder) => sync.writeSyncStep1(encoder, empty)),
    ];
    // Same-socket STEP1 response is a barrier after both malicious messages.
    const state = await bob.evaluate(
      ({ id, token, frames }) =>
        new Promise<number[]>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:1310/${id}?token=${encodeURIComponent(token)}`);
          ws.binaryType = 'arraybuffer';
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error('Protocol barrier timed out'));
          }, 10000);
          ws.onopen = () => frames.forEach((bytes) => ws.send(new Uint8Array(bytes)));
          ws.onerror = () => {
            clearTimeout(timer);
            ws.close();
            reject(new Error('Protocol connection failed'));
          };
          ws.onmessage = (event) => {
            const bytes = new Uint8Array(event.data as ArrayBuffer);
            if (bytes[0] === 0 && bytes[1] === 1) {
              clearTimeout(timer);
              ws.close();
              resolve(Array.from(bytes));
            }
          };
        }),
      { id, token, frames },
    );
    const decoder = decoding.createDecoder(new Uint8Array(state));
    expect(decoding.readVarUint(decoder)).toBe(0);
    expect(decoding.readVarUint(decoder)).toBe(1);
    sync.readSyncStep2(decoder, empty, null);
    expect(empty.getXmlFragment('default').toString()).toBe(
      '<paragraph>Only the owner can change this.</paragraph>',
    );
  } finally {
    malicious.destroy();
    empty.destroy();
  }
  await expect(content(alice)).not.toContainText('Forbidden');
  await bob.reload();
  await connected(bob);
  await expect.poll(() => documentText(bob)).toBe('Only the owner can change this.');
});
