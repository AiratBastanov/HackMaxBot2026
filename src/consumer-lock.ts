import { createHash } from 'node:crypto';
import { createServer } from 'node:net';

// Только loopback mutex, без HTTP, данных и публичного bind. OS освобождает его при crash.
// Коллизия порта безопасно отказывает; сторонний код обязан участвовать в этом протоколе.
export async function acquireConsumerLock(botId: string): Promise<() => Promise<void>> {
  const port = 30000 + createHash('sha256').update(`maxbot-consumer:${botId}`).digest().readUInt32BE() % 20000;
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(Error('SECOND_LOCAL_CONSUMER_OR_PORT_BUSY')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  return () => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
}
