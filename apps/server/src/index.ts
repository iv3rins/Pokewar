import { bootstrapServer } from './bootstrap.js';
import { loadConfig } from './config/config.js';

const config = loadConfig();
const server = await bootstrapServer(config);

server.httpServer.listen(config.port, config.host ?? '0.0.0.0', () => {
  console.log(
    `[server] PokeWar listening on http://${config.host ?? '0.0.0.0'}:${String(config.port)}`,
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] received ${signal}, shutting down`);
  await server.io.close();
  if (server.httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await server.closeInfrastructure();
}

function handleSignal(signal: string): void {
  void shutdown(signal).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('[server] shutdown failed', error);
      process.exit(1);
    },
  );
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));
