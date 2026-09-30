export type ConnectionState = { connected: boolean; synced: boolean; local: 'loading' | 'ready' | 'error'; denied: boolean };
export type ConnectionEvent = { type: 'connecting' | 'offline' | 'connected' | 'synced' | 'local-ready' | 'local-error' | 'denied' };
export const initialStatus: ConnectionState = { connected: false, synced: false, local: 'loading', denied: false };
export function statusReducer(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case 'connected': return { ...state, connected: true, denied: false };
    case 'synced': return { ...state, synced: true };
    case 'connecting': return { ...state, synced: false };
    case 'offline': return { ...state, connected: false, synced: false };
    case 'local-ready': return { ...state, local: 'ready' };
    case 'local-error': return { ...state, local: 'error' };
    case 'denied': return { ...state, connected: false, synced: false, denied: true };
  }
}
export function statusLabel(state: ConnectionState) {
  if (state.denied) return 'Access changed — reload or sign in';
  if (state.local === 'error') return 'Local storage unavailable';
  if (state.connected && state.synced) return 'Connected';
  if (state.connected || state.local === 'loading') return 'Syncing…';
  return 'Offline — changes saved locally';
}
