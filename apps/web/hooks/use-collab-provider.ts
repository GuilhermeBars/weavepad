'use client';
import { useEffect, useReducer, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Role } from '@weavepad/shared';
import type { Identity } from '../lib/access';
import { initialStatus, statusReducer } from '../lib/status';
import { usePresence } from './use-presence';
export type CollabResources = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  persistence: IndexeddbPersistence;
};
/** Owns the local CRDT cache and reconnects with a fresh, permission-checked token. */
export function useCollabProvider(id: string, user: Identity, onRole: (role: Role) => void) {
  const [resources, setResources] = useState<CollabResources>();
  const [status, dispatch] = useReducer(statusReducer, initialStatus);
  const { present, observePresence } = usePresence();
  useEffect(() => {
    const doc = new Y.Doc();
    // Keep local caches and broadcast channels isolated between accounts.
    const persistence = new IndexeddbPersistence(`weavepad:${user.id}:${id}`, doc);
    const provider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_SYNC_URL || 'ws://localhost:1234',
      id,
      doc,
      { connect: false, disableBc: true },
    );
    let disposed = false;
    let pending = false;
    let denied = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!disposed && !denied) {
        clearTimeout(retry);
        retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** attempts++, 15000));
      }
    };
    const connect = async () => {
      if (disposed || pending || denied || provider.wsconnected || provider.wsconnecting) return;
      if (!navigator.onLine) {
        dispatch({ type: 'offline' });
        return;
      }
      pending = true;
      dispatch({ type: 'connecting' });
      try {
        const response = await fetch(`/api/docs/${id}/token`, { cache: 'no-store' });
        if (disposed) return;
        if ([401, 403, 404].includes(response.status)) {
          denied = true;
          onRole('viewer');
          dispatch({ type: 'denied' });
          return;
        }
        if (!response.ok) throw new Error('Token unavailable');
        const data = (await response.json()) as { token: string; role: Role };
        if (disposed) return;
        onRole(data.role);
        provider.params = { token: data.token };
        // Disconnect clears remote states but retains their clocks. Accept the
        // server's initial presence even if those peers have not moved since.
        for (const client of provider.awareness.meta.keys()) {
          if (client !== doc.clientID && !provider.awareness.getStates().has(client))
            provider.awareness.meta.delete(client);
        }
        // Advance the presence clock past the server's disconnect tombstone.
        // Otherwise avatars can stay absent until the periodic awareness heartbeat.
        provider.awareness.setLocalStateField('user', user);
        provider.connect();
      } catch {
        if (!disposed) {
          dispatch({ type: 'offline' });
          schedule();
        }
      } finally {
        pending = false;
      }
    };
    provider.on('connection-close', () => {
      // Disable the provider's built-in retry so every connection has a fresh token.
      provider.shouldConnect = false;
      if (!disposed) {
        dispatch({ type: 'offline' });
        schedule();
      }
    });
    provider.on('status', ({ status: value }) => {
      if (!disposed) {
        dispatch({
          type:
            value === 'connected' ? 'connected' : value === 'connecting' ? 'connecting' : 'offline',
        });
        if (value === 'connected') attempts = 0;
      }
    });
    provider.on('sync', (synced: boolean) => {
      if (synced && !disposed) dispatch({ type: 'synced' });
    });
    provider.awareness.setLocalStateField('user', user);
    const stopPresence = observePresence(provider);
    const online = () => {
      attempts = 0;
      void connect();
    };
    const offline = () => {
      provider.disconnect();
      dispatch({ type: 'offline' });
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    void persistence.whenSynced
      .then(() => {
        if (!disposed) {
          dispatch({ type: 'local-ready' });
          setResources({ doc, provider, persistence });
          void connect();
        }
      })
      .catch(() => {
        if (!disposed) {
          dispatch({ type: 'local-error' });
          setResources({ doc, provider, persistence });
          void connect();
        }
      });
    return () => {
      disposed = true;
      clearTimeout(retry);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      stopPresence();
      provider.destroy();
      void persistence.destroy();
      doc.destroy();
    };
  }, [id, user, onRole, observePresence]);

  return { resources, status, present };
}
