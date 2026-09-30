import { assertPermission, type Permission, type Role } from '@weavepad/shared';
import { signCollabToken } from '@weavepad/shared/tokens';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Identity = { id: string; name: string; color: string };
export interface AccessRepository {
  role(documentId: string, userId: string): Promise<Role | null>;
}
export async function authorize(
  repo: AccessRepository,
  userId: string | undefined,
  documentId: string,
  permission: Permission,
) {
  if (!userId) throw new HttpError(401, 'Please sign in.');
  const role = await repo.role(documentId, userId);
  assertPermission(role, permission);
  return role;
}
export async function issueToken(
  repo: AccessRepository,
  user: Identity | undefined,
  documentId: string,
  secret: string,
  now = Date.now(),
) {
  const role = await authorize(repo, user?.id, documentId, 'read');
  if (!user) throw new HttpError(401, 'Please sign in.');
  return {
    token: signCollabToken(
      {
        userId: user.id,
        name: user.name,
        color: user.color,
        docId: documentId,
        role,
        exp: Math.floor(now / 1000) + 300,
      },
      secret,
    ),
    role,
  };
}
export function checkOwnerChange(
  roles: { userId: string; role: Role }[],
  target: string,
  next: Role | null,
) {
  if (
    roles.find((member) => member.userId === target)?.role === 'owner' &&
    next !== 'owner' &&
    roles.filter((member) => member.role === 'owner').length === 1
  ) {
    throw new HttpError(409, 'A document must keep at least one owner.');
  }
}
