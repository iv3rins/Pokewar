import { createClient, type RedisClientType } from 'redis';

export interface RedisClients {
  readonly command: RedisClientType;
  readonly publisher: RedisClientType;
  readonly subscriber: RedisClientType;
  close(): Promise<void>;
}

export async function createRedisClients(url: string): Promise<RedisClients> {
  const command = createClient({ url });
  command.on('error', (error) => console.error('[redis:command]', error));
  await command.connect();
  const publisher = command.duplicate();
  const subscriber = command.duplicate();
  publisher.on('error', (error) => console.error('[redis:publisher]', error));
  subscriber.on('error', (error) => console.error('[redis:subscriber]', error));
  await Promise.all([publisher.connect(), subscriber.connect()]);
  return {
    command,
    publisher,
    subscriber,
    async close() {
      await Promise.all([
        command.isOpen ? command.quit() : Promise.resolve(''),
        publisher.isOpen ? publisher.quit() : Promise.resolve(''),
        subscriber.isOpen ? subscriber.quit() : Promise.resolve(''),
      ]);
    },
  };
}
