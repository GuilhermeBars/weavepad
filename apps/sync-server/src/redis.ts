import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { z } from 'zod';

export type FanoutEvent = { kind: 'update' | 'awareness' | 'sync-request'; data: Uint8Array };
export interface Fanout {
  subscribe(id: string, receive: (event: FanoutEvent) => void): Promise<void>;
  unsubscribe(id: string): Promise<void>;
  publish(id: string, event: FanoutEvent): Promise<void>;
  close(): Promise<void>;
}
const envelope = z.object({ instance: z.string(), kind: z.enum(['update', 'awareness', 'sync-request']), data: z.string() });
export class RedisFanout implements Fanout {
  private readonly instance = randomUUID();
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, (event: FanoutEvent) => void>();
  constructor(url: string, logger: Logger) {
    const options = { maxRetriesPerRequest: 1, enableOfflineQueue: false };
    this.publisher = new Redis(url, options);
    this.subscriber = new Redis(url, options);
    for (const client of [this.publisher, this.subscriber]) client.on('error', (err) => logger.error({ err }, 'Redis connection error'));
    this.subscriber.on('ready', () => {
      // Recover document state missed during an interruption, after resubscribing.
      for (const channel of this.handlers.keys()) {
        void this.subscriber.subscribe(channel).then(async () => {
          const id = channel.slice('weavepad:doc:'.length);
          this.handlers.get(channel)?.({ kind: 'sync-request', data: new Uint8Array() });
          await this.publish(id, { kind: 'sync-request', data: new Uint8Array() });
        }).catch((err: unknown) => logger.error({ err }, 'Redis resubscription failed'));
      }
    });
    this.subscriber.on('message', (channel, message) => {
      try {
        const event = envelope.parse(JSON.parse(message));
        if (event.instance !== this.instance) this.handlers.get(channel)?.({ kind: event.kind, data: Buffer.from(event.data, 'base64') });
      } catch (err) { logger.warn({ err }, 'Invalid Redis message'); }
    });
  }
  private channel(id: string) { return `weavepad:doc:${id}`; }
  private async ready(client: Redis) {
    if (client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); client.off('ready', done); client.off('error', fail); };
      const done = () => { cleanup(); resolve(); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const timer = setTimeout(() => fail(new Error('Redis ready timeout')), 5000);
      client.once('ready', done); client.once('error', fail);
    });
  }
  async subscribe(id: string, receive: (event: FanoutEvent) => void) {
    await this.ready(this.subscriber);
    this.handlers.set(this.channel(id), receive);
    try { await this.subscriber.subscribe(this.channel(id)); }
    catch (err) { this.handlers.delete(this.channel(id)); throw err; }
  }
  async unsubscribe(id: string) {
    this.handlers.delete(this.channel(id));
    await this.subscriber.unsubscribe(this.channel(id));
  }
  async publish(id: string, event: FanoutEvent) {
    await this.ready(this.publisher);
    await this.publisher.publish(this.channel(id), JSON.stringify({ instance: this.instance, kind: event.kind, data: Buffer.from(event.data).toString('base64') }));
  }
  async close() { this.publisher.disconnect(); this.subscriber.disconnect(); }
}
