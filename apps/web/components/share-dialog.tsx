'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Role } from '@weavepad/shared';
import { api } from '../lib/client';
import { Dialog } from './dialog';
type Member = { userId: string; name: string; email: string; role: Role };
export function ShareDialog({ id, close, changed }: { id: string; close: () => void; changed: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setMembers(await api<Member[]>(`/${id}/members`)), [id]);
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [load]);
  async function mutate(path: string, method: string, data?: unknown) {
    setBusy(true); setError('');
    try { await api(path, method, data); await load(); changed(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title="Share document" close={close}><p className="muted">Invite someone who has signed in to Weavepad.</p><form className="stack" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void mutate(`/${id}/members`, 'POST', { email: data.get('email'), role: data.get('role') });
  }}><label>Email address<input name="email" type="email" placeholder="collaborator@example.com" required /></label><div className="row"><label className="grow">Permission<select name="role" defaultValue="editor"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="owner">Owner</option></select></label><button className="primary" disabled={busy}>Invite</button></div></form>
    {error && <p className="error" role="alert">{error}</p>}<h3 className="mt-8 mb-3 font-semibold">People with access</h3><ul className="member-list">{members.map((member) => <li key={member.userId}><div className="grow min-w-0"><strong>{member.name}</strong><small>{member.email}</small></div><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={(event) => void mutate(`/${id}/members/${member.userId}`, 'PATCH', { role: event.target.value })}><option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button disabled={busy} aria-label={`Remove ${member.email}`} onClick={() => void mutate(`/${id}/members/${member.userId}`, 'DELETE')}>✕</button></li>)}</ul></Dialog>;
}
