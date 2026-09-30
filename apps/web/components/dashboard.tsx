'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../lib/client';
type Document = { id: string; title: string; role: string; updatedAt: string };
export function Dashboard({ name }: { name: string }) {
  const router = useRouter();
  const [docs, setDocs] = useState<{ mine: Document[]; shared: Document[] }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setError(''); void api<{ mine: Document[]; shared: Document[] }>('').then(setDocs).catch((e: Error) => setError(e.message)); }, []);
  useEffect(load, [load]);
  return <main className="dashboard"><div className="dashboard-heading"><div><p className="eyebrow">A PLACE FOR YOUR NEXT IDEA</p><h1>Hello, {name.split(' ')[0]}.</h1><p className="muted">Pick up a thought, or start a new one.</p></div><button className="primary" disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { const doc = await api<Document>('', 'POST', { title: 'Untitled document' }); router.push(`/d/${doc.id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }}>{busy ? 'Creating…' : '+ New document'}</button></div>
    {error && <div role="alert" className="error">{error} <button onClick={load}>Retry</button></div>}
    {!docs && !error && <p role="status">Loading your workspace…</p>}
    {docs && (['mine', 'shared'] as const).map((section) => <section key={section} className="document-section"><div className="section-heading"><h2>{section === 'mine' ? 'My documents' : 'Shared with me'}</h2><span className="count">{docs[section].length}</span></div>{docs[section].length ? <div className="document-grid">{docs[section].map((doc) => <Link className="document-card" href={`/d/${doc.id}`} key={doc.id}><span className="document-icon" aria-hidden>▤</span><h3>{doc.title}</h3><div className="row between"><span className="muted">{new Date(doc.updatedAt).toLocaleDateString()}</span><span className="role">{doc.role}</span></div></Link>)}</div> : <div className="empty-state"><span aria-hidden>✧</span><h3>{section === 'mine' ? 'A blank page is a good beginning.' : 'Good work is better together.'}</h3><p>{section === 'mine' ? 'Create your first document and see where it takes you.' : 'Documents people share with your email will appear here.'}</p></div>}</section>)}
  </main>;
}
