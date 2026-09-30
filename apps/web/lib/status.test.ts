import { expect, it } from 'vitest';
import { initialStatus, statusLabel, statusReducer } from './status';
it('waits for protocol sync and distinguishes local persistence from connectivity', () => {
  let state = statusReducer(initialStatus, { type: 'local-ready' });
  expect(statusLabel(state)).toBe('Offline — changes saved locally');
  state = statusReducer(state, { type: 'connected' });
  expect(statusLabel(state)).toBe('Syncing…');
  state = statusReducer(state, { type: 'synced' });
  expect(statusLabel(state)).toBe('Connected');
  state = statusReducer(state, { type: 'offline' });
  expect(state.synced).toBe(false);
  expect(statusLabel(state)).toContain('saved locally');
  state = statusReducer(state, { type: 'local-error' });
  expect(statusLabel(state)).toBe('Local storage unavailable');
  state = statusReducer(state, { type: 'denied' });
  expect(statusLabel(state)).toContain('Access changed');
});
