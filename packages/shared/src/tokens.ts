import { createHmac, timingSafeEqual } from 'node:crypto';
import { isRole, type Role } from './roles.js';

export interface CollabToken {
  userId: string; name: string; color: string; docId: string; role: Role;
  /** Unix timestamp in seconds, exclusive. */
  exp: number;
}
export type TokenErrorCode = 'MALFORMED' | 'INVALID_SIGNATURE' | 'INVALID_CLAIMS' | 'EXPIRED';
export class CollabTokenError extends Error {
  constructor(public readonly code: TokenErrorCode, message: string) {
    super(message); this.name = 'CollabTokenError';
  }
}
function validateClaims(value: unknown): asserts value is CollabToken {
  if (typeof value !== 'object' || value === null) throw new CollabTokenError('INVALID_CLAIMS', 'Token claims must be an object');
  const claims = value as Record<string, unknown>;
  if (!['userId', 'name', 'color', 'docId'].every((key) => typeof claims[key] === 'string' && claims[key].length > 0)
    || !isRole(claims.role) || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp < 0) {
    throw new CollabTokenError('INVALID_CLAIMS', 'Invalid collaboration token claims');
  }
}
function signature(payload: string, secret: string): Buffer {
  if (!secret.trim()) throw new TypeError('COLLAB_TOKEN_SECRET must not be empty');
  return createHmac('sha256', secret).update(payload).digest();
}
/** Wire format: base64url(JSON claims).base64url(HMAC-SHA256(payload)). Not a JWT. */
export function signCollabToken(claims: CollabToken, secret: string): string {
  validateClaims(claims);
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}
export function verifyCollabToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): CollabToken {
  if (!secret.trim()) throw new TypeError('COLLAB_TOKEN_SECRET must not be empty');
  if (!Number.isFinite(nowSeconds)) throw new TypeError('Verification time must be finite');
  if (token.length > 16384) throw new CollabTokenError('MALFORMED', 'Token is too large');
  const parts = token.split('.');
  const payload = parts[0];
  const encodedSignature = parts[1];
  if (parts.length !== 2 || !payload || !encodedSignature || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(encodedSignature)) {
    throw new CollabTokenError('MALFORMED', 'Expected two base64url segments');
  }
  const supplied = Buffer.from(encodedSignature, 'base64url');
  const expected = signature(payload, secret);
  if (supplied.length !== expected.length || supplied.toString('base64url') !== encodedSignature || !timingSafeEqual(supplied, expected)) {
    throw new CollabTokenError('INVALID_SIGNATURE', 'Invalid collaboration token signature');
  }
  const bytes = Buffer.from(payload, 'base64url');
  if (bytes.toString('base64url') !== payload) throw new CollabTokenError('MALFORMED', 'Noncanonical base64url payload');
  let claims: unknown;
  try { claims = JSON.parse(bytes.toString('utf8')); }
  catch { throw new CollabTokenError('MALFORMED', 'Token payload is not JSON'); }
  validateClaims(claims);
  if (claims.exp <= nowSeconds) throw new CollabTokenError('EXPIRED', 'Collaboration token expired');
  return claims;
}
