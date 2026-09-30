import { describe, expect, it } from 'vitest';
import { assertPermission, assertRole, canRead, hasRole, permissions, PermissionError, ROLE_RANK, type Role } from './roles.js';
describe('roles', () => {
  it.each([
    ['viewer', [true, false, false, false, false, false]],
    ['editor', [true, true, true, true, false, false]],
    ['owner', [true, true, true, true, true, true]],
    [undefined, [false, false, false, false, false, false]],
    ['admin', [false, false, false, false, false, false]],
  ])('enforces every permission for %s', (role, expected) => {
    expect(Object.values(permissions).map((check) => check(role))).toEqual(expected);
    for (const [index, permission] of Object.keys(permissions).entries()) {
      const action = () => assertPermission(role, permission as keyof typeof permissions);
      if (expected[index]) expect(action).not.toThrow();
      else expect(action).toThrow(PermissionError);
    }
  });
  it('ranks and validates roles without prototype access', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeGreaterThan(ROLE_RANK.viewer);
    for (const invalid of [null, '', 'toString', '__proto__', 2, {}]) {
      expect(canRead(invalid)).toBe(false);
      expect(() => assertRole(invalid)).toThrow(TypeError);
    }
    for (const role of ['owner', 'editor', 'viewer'] as Role[]) {
      expect(hasRole(role, 'viewer')).toBe(true);
      expect(() => assertRole(role)).not.toThrow();
    }
  });
});
