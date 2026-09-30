import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CollabTokenError, signCollabToken, verifyCollabToken, type CollabToken } from './tokens.js';
const secret = 'test-secret-with-sufficient-entropy-for-tests';
const claims: CollabToken = { userId: 'user-1', name: 'Guilherme 📝', color: '#123456', docId: 'doc-1', role: 'editor', exp: 1000 };
function rawToken(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url');
}
function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(CollabTokenError);
  try { action(); } catch (error) { expect(error).toHaveProperty('code', code); }
}
describe('collab tokens', () => {
  it('roundtrips Unicode claims with unpadded base64url', () => {
    const token = signCollabToken(claims, secret);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(verifyCollabToken(token, secret, 999)).toEqual(claims);
  });
  it('rejects at and after expiry', () => {
    for (const now of [1000, 1001]) expectCode(() => verifyCollabToken(signCollabToken(claims, secret), secret, now), 'EXPIRED');
  });
  it('rejects wrong secret, tampered payload and short signature', () => {
    const token = signCollabToken(claims, secret);
    expectCode(() => verifyCollabToken(token, 'wrong', 999), 'INVALID_SIGNATURE');
    expectCode(() => verifyCollabToken(rawToken({ ...claims, role: 'owner' }).split('.')[0] + '.' + token.split('.')[1], secret, 999), 'INVALID_SIGNATURE');
    expectCode(() => verifyCollabToken(token.split('.')[0] + '.abc', secret, 999), 'INVALID_SIGNATURE');
  });
  it.each(['', 'abc', 'a.b.c', '=.x', 'a.', '.a', 'x'.repeat(16385)])('rejects malformed input', (token) => {
    expectCode(() => verifyCollabToken(token, secret, 999), 'MALFORMED');
  });
  it.each([null, [], {}, { ...claims, role: 'admin' }, { ...claims, exp: '1000' }, { ...claims, exp: 1.5 }, { ...claims, userId: '' }])('validates authenticated claims', (value) => {
    expectCode(() => verifyCollabToken(rawToken(value), secret, 999), 'INVALID_CLAIMS');
  });
  it('rejects signed invalid JSON and invalid configuration', () => {
    const payload = Buffer.from('{').toString('base64url');
    expectCode(() => verifyCollabToken(payload + '.' + createHmac('sha256', secret).update(payload).digest('base64url'), secret, 999), 'MALFORMED');
    expect(() => signCollabToken(claims, '')).toThrow(TypeError);
    expect(() => verifyCollabToken('a.b', '')).toThrow(TypeError);
    expect(() => verifyCollabToken(signCollabToken(claims, secret), secret, NaN)).toThrow(TypeError);
  });
});
