import * as Y from 'yjs';
import { diffArrays, diffLines, diffWordsWithSpace } from 'diff';
import { DOCUMENT_FRAGMENT } from './protocol.js';

export interface PlainBlock {
  type: string;
  attributes: Record<string, string>;
  text: string;
  children: PlainBlock[];
}
function plainNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook): PlainBlock {
  if (node instanceof Y.XmlText) {
    // toString() serializes marks as XML; delta inserts yield actual text.
    const text = node.toDelta().map((part: { insert?: unknown }) => typeof part.insert === 'string' ? part.insert : '\uFFFC').join('');
    return { type: 'text', attributes: {}, text, children: [] };
  }
  if (node instanceof Y.XmlHook) throw new TypeError('XmlHook is not supported in TipTap content');
  const children = node.toArray().map(plainNode);
  const separator = ['bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.nodeName) ? '\n' : '';
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.getAttributes())) {
    if (value !== undefined) attributes[key] = value;
  }
  return { type: node.nodeName, attributes, text: node.nodeName === 'hardBreak' ? '\n' : children.map((child) => child.text).join(separator), children };
}
export function fragmentToPlainBlocks(fragment: Y.XmlFragment): PlainBlock[] {
  return fragment.toArray().map(plainNode);
}
export function createSnapshot(doc: Y.Doc): Uint8Array { return Y.encodeStateAsUpdate(doc); }
export function snapshotToPlainBlocks(state: Uint8Array): PlainBlock[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return fragmentToPlainBlocks(doc.getXmlFragment(DOCUMENT_FRAGMENT));
  } finally { doc.destroy(); }
}
export function snapshotToPlainText(state: Uint8Array): string {
  return snapshotToPlainBlocks(state).map((block) => block.text).join('\n');
}
export function diffSnapshots(before: Uint8Array, after: Uint8Array) {
  const beforeBlocks = snapshotToPlainBlocks(before);
  const afterBlocks = snapshotToPlainBlocks(after);
  const a = beforeBlocks.map((block) => block.text).join('\n');
  const b = afterBlocks.map((block) => block.text).join('\n');
  return {
    blocks: diffArrays(beforeBlocks, afterBlocks, { comparator: (left, right) => JSON.stringify(left) === JSON.stringify(right) }),
    lines: diffLines(a, b),
    words: diffWordsWithSpace(a, b),
  };
}
export const RESTORE_ORIGIN = 'weavepad:restore';
/** Replace only the editor fragment in one NEW transaction, preserving CRDT history.
 * Concurrent unseen edits still merge by Yjs rules; restore is not a global reset.
 */
export function applyRestore(liveDoc: Y.Doc, snapshotState: Uint8Array): void {
  const source = new Y.Doc();
  try {
    Y.applyUpdate(source, snapshotState);
    const content = source.getXmlFragment(DOCUMENT_FRAGMENT).toArray();
    const clones = content.map((node) => {
      if (node instanceof Y.XmlHook) throw new TypeError('XmlHook is not supported in TipTap content');
      return node.clone();
    });
    const live = liveDoc.getXmlFragment(DOCUMENT_FRAGMENT);
    liveDoc.transact(() => {
      live.delete(0, live.length);
      live.insert(0, clones);
    }, RESTORE_ORIGIN);
  } finally { source.destroy(); }
}
