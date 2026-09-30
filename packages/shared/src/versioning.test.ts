import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { applyRestore, createSnapshot, diffSnapshots, fragmentToPlainBlocks, RESTORE_ORIGIN, snapshotToPlainBlocks, snapshotToPlainText } from './versioning.js';
const docs: Y.Doc[] = [];
function doc(state?: Uint8Array) {
  const result = new Y.Doc(); docs.push(result);
  if (state) Y.applyUpdate(result, state);
  return result;
}
function paragraph(text: string, type = 'paragraph') {
  const node = new Y.XmlElement(type);
  const content = new Y.XmlText(); content.insert(0, text); node.insert(0, [content]);
  return node;
}
function withText(...texts: string[]) {
  const result = doc(); result.getXmlFragment('default').insert(0, texts.map((text) => paragraph(text))); return result;
}
function text(result: Y.Doc) { return snapshotToPlainText(createSnapshot(result)); }
afterEach(() => { docs.splice(0).forEach((result) => result.destroy()); });
describe('versioning', () => {
  it('extracts nested lists, hard breaks, Unicode and marked text without XML markup', () => {
    const result = doc();
    const heading = paragraph('Olá world', 'heading');
    heading.setAttribute('level', '2');
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    item.insert(0, [paragraph('One'), paragraph('Two')]); list.insert(0, [item]);
    result.getXmlFragment('default').insert(0, [heading, list, paragraph('')]);
    const rich = heading.get(0) as Y.XmlText;
    rich.format(0, 3, { bold: {} });
    heading.insert(1, [new Y.XmlElement('hardBreak'), new Y.XmlText('end')]);
    expect(text(result)).toBe('Olá world\nend\nOne\nTwo\n');
    const blocks = fragmentToPlainBlocks(result.getXmlFragment('default'));
    expect(blocks[0]?.attributes).toEqual({ level: '2' });
    expect(blocks[1]?.children[0]?.children).toHaveLength(2);
    expect(snapshotToPlainBlocks(createSnapshot(result))).toEqual(blocks);
  });
  it('diffs blocks, lines and words including additions, removals and empty documents', () => {
    const a = createSnapshot(withText('hello world', 'removed'));
    const b = createSnapshot(withText('hello friend', 'added'));
    const diff = diffSnapshots(a, b);
    expect(diff.blocks.some((change) => change.added)).toBe(true);
    expect(diff.lines.some((change) => change.removed)).toBe(true);
    expect(diff.words.find((change) => change.added)?.value).toContain('friend');
    expect(diffSnapshots(a, a).words.every((change) => !change.added && !change.removed)).toBe(true);
    expect(diffSnapshots(createSnapshot(doc()), b).blocks[0]?.added).toBe(true);
    expect(diffSnapshots(a, createSnapshot(doc())).blocks[0]?.removed).toBe(true);
  });
  it('restores rich content in one forward transaction and preserves unrelated shared state', () => {
    const live = withText('original');
    const node = live.getXmlFragment('default').get(0) as Y.XmlElement;
    node.setAttribute('align', 'center');
    (node.get(0) as Y.XmlText).format(0, 8, { bold: {} });
    const snapshot = createSnapshot(live);
    const expected = live.getXmlFragment('default').toString();
    (node.get(0) as Y.XmlText).insert(8, ' changed');
    live.getMap('metadata').set('title', 'keep');
    const peer = doc(createSnapshot(live));
    const clock = Y.encodeStateVector(live);
    const updates: Uint8Array[] = [];
    live.on('update', (update: Uint8Array, origin: unknown) => { expect(origin).toBe(RESTORE_ORIGIN); updates.push(update); });
    applyRestore(live, snapshot);
    expect(updates).toHaveLength(1);
    expect(Y.encodeStateVector(live)).not.toEqual(clock);
    expect(live.getXmlFragment('default').toString()).toBe(expected);
    expect(live.getMap('metadata').get('title')).toBe('keep');
    Y.applyUpdate(peer, updates[0]!);
    expect(peer.getXmlFragment('default').toString()).toBe(expected);
    applyRestore(live, snapshot);
    expect(live.getXmlFragment('default').toString()).toBe(expected);
  });
  it.each([false, true])('converges after concurrent offline edits and restore (reverse=%s)', (reverse) => {
    const live = withText('saved');
    const snapshot = createSnapshot(live);
    const offline = doc(snapshot);
    (live.getXmlFragment('default').get(0) as Y.XmlElement).insert(1, [new Y.XmlText(' online')]);
    (offline.getXmlFragment('default').get(0) as Y.XmlElement).insert(1, [new Y.XmlText(' offline')]);
    offline.getXmlFragment('default').insert(1, [paragraph('offline new block')]);
    applyRestore(live, snapshot);
    expect(text(live)).toBe('saved');
    const restoreUpdate = createSnapshot(live);
    const offlineUpdate = createSnapshot(offline);
    const observer = doc(snapshot);
    for (const update of reverse ? [offlineUpdate, restoreUpdate] : [restoreUpdate, offlineUpdate]) Y.applyUpdate(observer, update);
    Y.applyUpdate(live, offlineUpdate);
    Y.applyUpdate(offline, restoreUpdate);
    Y.applyUpdate(live, offlineUpdate); // Delivery can be duplicated.
    expect(text(live)).toContain('saved');
    expect(text(live)).toContain('offline new block');
    expect(live.getXmlFragment('default').toString()).toBe(offline.getXmlFragment('default').toString());
    expect(text(observer)).toBe(text(live));
    expect(Y.encodeStateVector(live)).toEqual(Y.encodeStateVector(offline));
  });
  it('converges with concurrent restores of different snapshots', () => {
    const a = withText('base'); const b = doc(createSnapshot(a));
    applyRestore(a, createSnapshot(withText('A')));
    applyRestore(b, createSnapshot(withText('B')));
    const aUpdate = createSnapshot(a); const bUpdate = createSnapshot(b);
    Y.applyUpdate(a, bUpdate); Y.applyUpdate(b, aUpdate);
    expect(text(a)).toBe(text(b));
  });
  it('restores an empty snapshot and does not mutate live content on corrupt input', () => {
    const live = withText('keep');
    expect(() => applyRestore(live, new Uint8Array([255]))).toThrow();
    expect(text(live)).toBe('keep');
    applyRestore(live, createSnapshot(doc()));
    expect(live.getXmlFragment('default').length).toBe(0);
  });
});
