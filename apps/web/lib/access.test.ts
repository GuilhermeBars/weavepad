import { describe, expect, it, vi } from 'vitest';
import { verifyCollabToken } from '@weavepad/shared/tokens';
import type { Role } from '@weavepad/shared';
import { authorize, checkOwnerChange, issueToken } from './access';
const repo = (role: Role | null) => ({ role: vi.fn(async () => role) });
describe('web access boundary', () => {
  it('does not query the repository for unauthenticated requests', async () => {
    const repository = repo('owner');
    await expect(authorize(repository, undefined, 'doc', 'read')).rejects.toMatchObject({ status: 401 });
    expect(repository.role).not.toHaveBeenCalled();
  });
  it.each(['read', 'manage', 'share', 'snapshot', 'restore'] as const)('rejects non-members for %s', async (permission) => {
    await expect(authorize(repo(null), 'user', 'doc', permission)).rejects.toThrow('Permission denied');
  });
  it.each(['snapshot', 'restore', 'manage', 'share'] as const)('rejects viewers for %s', async (permission) => {
    await expect(authorize(repo('viewer'), 'user', 'doc', permission)).rejects.toThrow('Permission denied');
  });
  it('allows editors to version but not manage', async () => {
    await expect(authorize(repo('editor'), 'user', 'doc', 'snapshot')).resolves.toBe('editor');
    await expect(authorize(repo('editor'), 'user', 'doc', 'restore')).resolves.toBe('editor');
    await expect(authorize(repo('editor'), 'user', 'doc', 'manage')).rejects.toThrow();
  });
  it('issues a short-lived token using the repository role and authenticated identity', async () => {
    const repository = repo('viewer');
    const { token } = await issueToken(repository, { id: 'u1', name: 'Alex', color: '#6366f1' }, 'doc', 'secret', 1000000);
    expect(verifyCollabToken(token, 'secret', 1000)).toEqual({ userId: 'u1', name: 'Alex', color: '#6366f1', docId: 'doc', role: 'viewer', exp: 1300 });
    expect(repository.role).toHaveBeenCalledWith('doc', 'u1');
    expect(() => verifyCollabToken(token, 'secret', 1300)).toThrow();
    await expect(issueToken(repo(null), { id: 'u1', name: 'A', color: '#6366f1' }, 'doc', 'secret')).rejects.toThrow();
  });
  it('prevents removing or demoting the last owner, including invitation upserts', () => {
    const members = [{ userId: 'a', role: 'owner' as const }, { userId: 'b', role: 'editor' as const }];
    expect(() => checkOwnerChange(members, 'a', null)).toThrow('at least one owner');
    expect(() => checkOwnerChange(members, 'a', 'viewer')).toThrow();
    expect(() => checkOwnerChange(members, 'a', 'owner')).not.toThrow();
    expect(() => checkOwnerChange([...members, { userId: 'c', role: 'owner' }], 'a', null)).not.toThrow();
  });
});
