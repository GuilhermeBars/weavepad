import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { pino } from 'pino';

const { clients } = vi.hoisted(() => ({ clients: [] as { emit: (name: string, ...args: unknown[]) => boolean; publish: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] }));
vi.mock('ioredis', () => ({ Redis: class extends EventEmitter {
  status = 'ready';
  publish = vi.fn(async () => 1);
  subscribe = vi.fn(async () => 1);
  unsubscribe = vi.fn(async () => 0);
  disconnect = vi.fn();
  constructor() { super(); clients.push(this); }
} }));
import { RedisFanout } from './redis.js';

it('Redis adapter uses document channels, suppresses instance echoes and closes both connections', async () => {
  const bus = new RedisFanout('redis://localhost', pino({ level: 'silent' }));
  try {
    const receive = vi.fn(); await bus.subscribe('doc', receive);
    const publisher = clients[0]!; const subscriber = clients[1]!;
    await bus.publish('doc', { kind: 'update', data: new Uint8Array([0, 255, 42]) });
    const [channel, message] = publisher.publish.mock.calls[0] as unknown as [string, string];
    expect(channel).toBe('weavepad:doc:doc');
    subscriber.emit('message', channel, message); expect(receive).not.toHaveBeenCalled();
    const other = { ...JSON.parse(message), instance: 'another-instance' };
    subscriber.emit('message', channel, JSON.stringify(other));
    expect(receive).toHaveBeenCalledWith({ kind: 'update', data: Buffer.from([0, 255, 42]) });
    subscriber.emit('message', channel, 'bad JSON'); expect(receive).toHaveBeenCalledTimes(1);
    subscriber.emit('ready');
    await vi.waitFor(() => expect(publisher.publish).toHaveBeenCalledTimes(2));
    expect(receive).toHaveBeenLastCalledWith({ kind: 'sync-request', data: new Uint8Array() });
    await bus.unsubscribe('doc'); subscriber.emit('message', channel, JSON.stringify(other)); expect(receive).toHaveBeenCalledTimes(2);
  } finally { await bus.close(); }
  expect(clients[0]!.disconnect).toHaveBeenCalledOnce(); expect(clients[1]!.disconnect).toHaveBeenCalledOnce();
});
