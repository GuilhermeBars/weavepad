import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PermissionError } from '@weavepad/shared';
import { handleApi, handleDocumentApi } from './api';
import { HttpError } from './access';
import { POST as saveSnapshot } from '../app/api/docs/[id]/snapshots/route';
import { GET as getToken } from '../app/api/docs/[id]/token/route';
import { verifyCollabToken } from '@weavepad/shared/tokens';

const { auth, role } = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn() }));
vi.mock('../auth', () => ({ auth }));
vi.mock('./db', () => ({ db: {}, repository: { role } }));

const id = '00000000-0000-4000-8000-000000000001';
const user = { id: '00000000-0000-4000-8000-000000000002', name: 'Ada', color: '#123456' };
const context = { params: Promise.resolve({ id }) };

beforeEach(() => {
  auth.mockResolvedValue({ user });
  role.mockResolvedValue('editor');
  vi.stubEnv('AUTH_URL', 'http://localhost:3107');
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function request(method = 'GET', body?: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3107/api/docs/${id}`, {
    method,
    headers: { origin: 'http://localhost:3107', ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

it('rejects unauthenticated requests before invoking the operation', async () => {
  auth.mockResolvedValue(null);
  const operation = vi.fn();
  const response = await handleApi(request(), operation);
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(operation).not.toHaveBeenCalled();
});

it('checks the public origin before reading a mutation body', async () => {
  const operation = vi.fn();
  const response = await handleApi(
    request('POST', '{}', { origin: 'https://other.test' }),
    operation,
  );
  expect(response.status).toBe(403);
  expect(operation).not.toHaveBeenCalled();
});

it.each([
  ['{', 400],
  [' '.repeat(16385), 413],
])('rejects invalid or oversized JSON', async (body, status) => {
  const response = await handleApi(request('POST', body), async ({ readInput }) =>
    Response.json(await readInput()),
  );
  expect(response.status).toBe(status);
});

it('rejects oversized content-length before invoking the operation', async () => {
  const operation = vi.fn();
  const response = await handleApi(request('POST', '{}', { 'content-length': '16385' }), operation);
  expect(response.status).toBe(413);
  expect(operation).not.toHaveBeenCalled();
});

it('validates document IDs before querying access', async () => {
  const response = await handleDocumentApi(
    request(),
    { params: Promise.resolve({ id: 'invalid' }) },
    vi.fn(),
  );
  expect(response.status).toBe(400);
  expect(role).not.toHaveBeenCalled();
});

it('denies a nonmember before invoking a document operation', async () => {
  role.mockResolvedValue(null);
  const operation = vi.fn();
  const response = await handleDocumentApi(request(), context, operation);
  expect(response.status).toBe(403);
  expect(operation).not.toHaveBeenCalled();
});

it.each([
  [new HttpError(409, 'Keep an owner.'), 409, 'Keep an owner.'],
  [new PermissionError('share'), 403, 'Permission denied: share'],
  [new z.ZodError([]), 400, 'Check the supplied fields.'],
  [new Error('private database detail'), 500, 'Something went wrong. Please try again.'],
])('preserves safe error responses', async (error, status, message) => {
  const response = await handleApi(request(), async () => {
    throw error;
  });
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: message });
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('enforces viewer snapshot permissions before parsing input', async () => {
  role.mockResolvedValue('viewer');
  const response = await saveSnapshot(request('POST', '{'), context);
  expect(response.status).toBe(403);
});

it('issues a token for the route document and current membership', async () => {
  vi.stubEnv('COLLAB_TOKEN_SECRET', 'route-test-secret');
  role.mockResolvedValue('viewer');
  const response = await getToken(request(), context);
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.role).toBe('viewer');
  expect(verifyCollabToken(result.token, 'route-test-secret')).toMatchObject({
    docId: id,
    userId: user.id,
    role: 'viewer',
    name: user.name,
  });
});
