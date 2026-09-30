'use client';
import { useEffect, useReducer, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Role } from '@weavepad/shared';
import type { Identity } from '../lib/access';
import { initialStatus, statusLabel, statusReducer } from '../lib/status';

type Resources = { doc: Y.Doc; provider: WebsocketProvider; persistence: IndexeddbPersistence };
export function CollaborativeEditor({ id, user, role, onConnection, onRole }: { id: string; user: Identity; role: Role; onConnection: (value: boolean) => void; onRole: (value: Role) => void }) {
  const [resources, setResources] = useState<Resources>();
  const [status, dispatch] = useReducer(statusReducer, initialStatus);
  const [present, setPresent] = useState<{ name: string; color: string; client: number }[]>([]);
  useEffect(() => {
    const doc = new Y.Doc();
    // Keep local caches and broadcast channels isolated between accounts.
    const persistence = new IndexeddbPersistence(`weavepad:${user.id}:${id}`, doc);
    const provider = new WebsocketProvider(process.env.NEXT_PUBLIC_SYNC_URL || 'ws://localhost:1234', id, doc, { connect: false, disableBc: true });
    let disposed = false;
    let pending = false;
    let denied = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { if (!disposed && !denied) { clearTimeout(retry); retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** attempts++, 15000)); } };
    const connect = async () => {
      if (disposed || pending || denied || provider.wsconnected || provider.wsconnecting) return;
      if (!navigator.onLine) { dispatch({ type: 'offline' }); return; }
      pending = true;
      dispatch({ type: 'connecting' });
      try {
        const response = await fetch(`/api/docs/${id}/token`, { cache: 'no-store' });
        if (disposed) return;
        if ([401, 403, 404].includes(response.status)) { denied = true; onRole('viewer'); dispatch({ type: 'denied' }); return; }
        if (!response.ok) throw new Error('Token unavailable');
        const data = await response.json() as { token: string; role: Role };
        if (disposed) return;
        onRole(data.role);
        provider.params = { token: data.token };
        // Disconnect clears remote states but retains their clocks. Accept the
        // server's initial presence even if those peers have not moved since.
        for (const client of provider.awareness.meta.keys()) {
          if (client !== doc.clientID && !provider.awareness.getStates().has(client)) provider.awareness.meta.delete(client);
        }
        // Advance the presence clock past the server's disconnect tombstone.
        // Otherwise avatars can stay absent until the periodic awareness heartbeat.
        provider.awareness.setLocalStateField('user', user);
        provider.connect();
      } catch { if (!disposed) { dispatch({ type: 'offline' }); schedule(); } }
      finally { pending = false; }
    };
    provider.on('connection-close', () => {
      // Disable the provider's built-in retry so every connection has a fresh token.
      provider.shouldConnect = false;
      if (!disposed) { dispatch({ type: 'offline' }); schedule(); }
    });
    provider.on('status', ({ status: value }) => { if (!disposed) { dispatch({ type: value === 'connected' ? 'connected' : value === 'connecting' ? 'connecting' : 'offline' }); if (value === 'connected') attempts = 0; } });
    provider.on('sync', (synced: boolean) => { if (synced && !disposed) dispatch({ type: 'synced' }); });
    const awareness = () => setPresent(Array.from(provider.awareness.getStates()).flatMap(([client, state]) => {
      const person = state.user as { name?: unknown; color?: unknown } | undefined;
      return person && typeof person.name === 'string' ? [{ client, name: person.name.slice(0, 80), color: typeof person.color === 'string' && /^#[\da-f]{6}$/i.test(person.color) ? person.color : '#6366f1' }] : [];
    }));
    provider.awareness.setLocalStateField('user', user);
    provider.awareness.on('change', awareness); awareness();
    const online = () => { attempts = 0; void connect(); };
    const offline = () => { provider.disconnect(); dispatch({ type: 'offline' }); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    void persistence.whenSynced.then(() => {
      if (!disposed) { dispatch({ type: 'local-ready' }); setResources({ doc, provider, persistence }); void connect(); }
    }).catch(() => { if (!disposed) { dispatch({ type: 'local-error' }); setResources({ doc, provider, persistence }); void connect(); } });
    return () => {
      disposed = true; clearTimeout(retry); window.removeEventListener('online', online); window.removeEventListener('offline', offline);
      provider.awareness.off('change', awareness); provider.destroy(); void persistence.destroy(); doc.destroy();
    };
  }, [id, user, onRole]);
  useEffect(() => onConnection(status.connected && status.synced && !status.denied), [status, onConnection]);
  return <><div className="presence-bar"><span role="status" className={`connection ${status.connected && status.synced ? 'online' : ''}`}><span aria-hidden>●</span> {statusLabel(status)}</span><div className="avatars" aria-label="People in this document">{present.slice(0, 6).map((person) => <span key={person.client} className="avatar" style={{ backgroundColor: person.color }} title={person.name} aria-label={person.name}>{person.name.slice(0, 1).toUpperCase()}</span>)}{present.length > 6 && <span>+{present.length - 6}</span>}</div></div>{resources ? <Editor resources={resources} user={user} editable={role !== 'viewer' && !status.denied} /> : <div className="editor-paper" role="status">Opening your document…</div>}</>;
}
function Editor({ resources, user, editable }: { resources: Resources; user: Identity; editable: boolean }) {
  const editor = useEditor({
    immediatelyRender: false, shouldRerenderOnTransaction: true, editable,
    extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: resources.doc }), CollaborationCaret.configure({ provider: resources.provider, user })],
    editorProps: { attributes: { class: 'document-content', 'aria-label': 'Document content', role: 'textbox', 'aria-multiline': 'true' } },
  }, [resources]);
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);
  if (!editor) return <div role="status">Loading editor…</div>;
  const actions = [
    { label: 'Bold', text: 'B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', text: 'I', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Heading', text: 'H2', active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Bullet list', text: '• List', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', text: '1. List', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Code block', text: '</>', active: editor.isActive('codeBlock'), run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: 'Quote', text: '❝', active: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];
  return <><div className="toolbar" role="toolbar" aria-label="Text formatting">{actions.map((action) => <button key={action.label} aria-label={action.label} title={action.label} aria-pressed={action.active} disabled={!editable} onClick={action.run}>{action.text}</button>)}<span className="toolbar-divider" /><button aria-label="Undo" disabled={!editable || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</button><button aria-label="Redo" disabled={!editable || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</button>{!editable && <span className="role">View only</span>}</div><div className="editor-paper"><EditorContent editor={editor} />{editor.isEmpty && editable && <p className="editor-hint" aria-hidden>Start with a thought…</p>}</div><p className="editor-footnote">{editable ? 'Your words stay on this device when you go offline.' : 'You have view-only access to this document.'}</p></>;
}
