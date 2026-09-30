export const ROLES = ['viewer', 'editor', 'owner'] as const;
export type Role = typeof ROLES[number];
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 0, editor: 1, owner: 2 };
export function isRole(value: unknown): value is Role {
  return value === 'viewer' || value === 'editor' || value === 'owner';
}
export function hasRole(role: unknown, minimum: Role): role is Role {
  return isRole(role) && ROLE_RANK[role] >= ROLE_RANK[minimum];
}
export const canRead = (role: unknown) => hasRole(role, 'viewer');
export const canEdit = (role: unknown) => hasRole(role, 'editor');
export const canSnapshot = canEdit;
export const canRestore = canEdit;
export const canShare = (role: unknown) => hasRole(role, 'owner');
export const canManage = canShare;
export const permissions = { read: canRead, edit: canEdit, snapshot: canSnapshot, restore: canRestore, share: canShare, manage: canManage };
export type Permission = keyof typeof permissions;
export class PermissionError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(public readonly permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = 'PermissionError';
  }
}
export function assertPermission(role: unknown, permission: Permission): asserts role is Role {
  if (!permissions[permission](role)) throw new PermissionError(permission);
}
export function assertRole(value: unknown): asserts value is Role {
  if (!isRole(value)) throw new TypeError('Invalid document role');
}
export const assertCanRead = (role: unknown): void => assertPermission(role, 'read');
export const assertCanEdit = (role: unknown): void => assertPermission(role, 'edit');
export const assertCanSnapshot = (role: unknown): void => assertPermission(role, 'snapshot');
export const assertCanRestore = (role: unknown): void => assertPermission(role, 'restore');
export const assertCanShare = (role: unknown): void => assertPermission(role, 'share');
export const assertCanManage = (role: unknown): void => assertPermission(role, 'manage');
