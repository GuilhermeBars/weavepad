'use client';
import { useCallback, useState } from 'react';
import type { WebsocketProvider } from 'y-websocket';
export type PresentPerson = { name: string; color: string; client: number };
export function usePresence() {
  const [present, setPresent] = useState<PresentPerson[]>([]);
  const observePresence = useCallback((provider: WebsocketProvider) => {
    const awareness = () =>
      setPresent(
        Array.from(provider.awareness.getStates()).flatMap(([client, state]) => {
          const person = state.user as { name?: unknown; color?: unknown } | undefined;
          return person && typeof person.name === 'string'
            ? [
                {
                  client,
                  name: person.name.slice(0, 80),
                  color:
                    typeof person.color === 'string' && /^#[\da-f]{6}$/i.test(person.color)
                      ? person.color
                      : '#6366f1',
                },
              ]
            : [];
        }),
      );
    provider.awareness.on('change', awareness);
    awareness();

    return () => provider.awareness.off('change', awareness);
  }, []);
  return { present, observePresence };
}
