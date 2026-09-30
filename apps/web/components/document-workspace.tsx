'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Role } from '@weavepad/shared';
import type { Identity } from '../lib/access';
import { api } from '../lib/client';
import { ShareDialog } from './share-dialog';
import { HistoryPanel } from './history-panel';
import { Dialog } from './dialog';
const CollaborativeEditor = dynamic(() => import('./collaborative-editor').then((m) => m.CollaborativeEditor), { ssr: false, loading: () => <p className="p-8" role="status">Opening your document…</p> });
export function DocumentWorkspace({ id, title: originalTitle, role: initialRole, user }: { id: string; title: string; role: Role; user: Identity }) {
  const router = useRouter();
  const [title, setTitle] = useState(originalTitle);
  const [role, setRole] = useState(initialRole);
  const [share, setShare] = useState(false);
  const [history, setHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <><header className="app-header editor-header"><Link className="brand" href="/" aria-label="Back to workspace">▧ <span>weavepad</span></Link><div className="row"><span className="role">{role}</span><button aria-expanded={history} onClick={() => setHistory(!history)}>History</button>{role === 'owner' && <button className="primary" onClick={() => setShare(true)}>Share</button>}</div></header><div className={`workspace ${history ? 'with-history' : ''}`}><main className="editor-main"><div className="document-title-row">{role === 'owner' ? <form className="row grow" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(''); try { await api(`/${id}`, 'PATCH', { title }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><input className="document-title" aria-label="Document title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required /><button disabled={busy} aria-label="Save document title">Save title</button></form> : <h1 className="document-title">{title}</h1>}{role === 'owner' && <button className="subtle" aria-label="Delete document" onClick={() => setDeleting(true)}>Delete</button>}</div>{error && <p role="alert" className="error">{error}</p>}<CollaborativeEditor id={id} user={user} role={role} onConnection={setConnected} onRole={setRole} /></main>{history && <HistoryPanel id={id} editable={role !== 'viewer'} connected={connected} close={() => setHistory(false)} />}</div>
    {share && <ShareDialog id={id} close={() => setShare(false)} changed={() => { router.refresh(); }} />}
    {deleting && <Dialog title="Delete document?" close={() => setDeleting(false)}><p>This permanently deletes the document and its versions for everyone.</p>{error && <p className="error" role="alert">{error}</p>}<div className="row justify-end mt-6"><button onClick={() => setDeleting(false)}>Cancel</button><button className="danger" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/${id}`, 'DELETE'); router.push('/'); } catch (e) { setError((e as Error).message); setBusy(false); } }}>Delete permanently</button></div></Dialog>}
  </>;
}
