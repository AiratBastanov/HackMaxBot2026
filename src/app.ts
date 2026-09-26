import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { Config } from './config.js';
import { parseJson } from './contracts.js';
import { admitUpdate } from './admission.js';
import { createTransport, type MaxTransport } from './max.js';
import { Storage } from './storage.js';
import { Worker } from './worker.js';
import { Catalog } from './culture/catalog.js';

export function createApp(config: Config, options: { store?: Storage; transport?: MaxTransport; clock?: () => number; catalog?: Catalog; report?: (value: object) => void } = {}) {
  if (config.ingress && config.ingress !== 'webhook' || !config.webhookSecret) throw Error('WEBHOOK_INGRESS_REQUIRED');
  if (config.mode === 'live' && (options.clock||config.flowTestClock)) throw new Error('LIVE_CLOCK_INJECTION_FORBIDDEN');
  const catalog = options.catalog ?? Catalog.load(config);
  if (catalog.mode !== config.flowDataMode) throw new Error('CATALOG_MODE_MISMATCH');
  const started = Date.now();
  if (config.flowTestClock && config.flowDataMode !== 'synthetic-test') throw new Error('LIVE_CLOCK_INJECTION_FORBIDDEN');
  const clock = options.clock ?? (config.flowTestClock ? () => Date.parse(config.flowTestClock!) + Date.now() - started : Date.now);
  const store = options.store ?? new Storage(config.databasePath, config);
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 5000, connectionTimeout: 5000 });
  const worker = new Worker(store, config, options.transport ?? createTransport(config,store), clock, options.report, catalog);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    try { done(null, parseJson(body as string)); } catch { const e = Object.assign(new Error('Некорректный JSON'), { statusCode: 400 }); done(e); }
  });
  app.setErrorHandler((error, _request, reply) => {
    const code = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = code === 413 ? 413 : code === 415 ? 415 : code === 400 ? 400 : 503;
    reply.code(status).send({ error: status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : status === 400 ? 'invalid_request' : 'temporarily_unavailable' });
  });
  app.get('/healthz', async (_request, reply) => {
    try { store.health(); return { status: 'ok', mode: config.mode }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.post('/webhooks/max', {
    onRequest: async (request, reply) => {
      const received = request.headers['x-max-bot-api-secret'];
      const expected = Buffer.from(config.webhookSecret!);
      const actual = Buffer.from(typeof received === 'string' ? received : '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply.code(401).send({ error: 'unauthorized' });
    },
  }, async (request, reply) => {
    let parsed;
    try { parsed = admitUpdate(request.body, config); }
    catch { return reply.code(400).send({ error: 'invalid_update' }); }
    if (parsed.ignored) return { status: 'ignored' };
    try { return { status: store.accept(parsed.event, clock()) }; }
    catch { options.report?.({ operation: 'webhook_accept', errorClass: 'PERSISTENCE' }); return reply.code(503).send({ error: 'persistence_unavailable' }); }
  });
  app.addHook('onClose', async () => { await worker.stop(); store.close(); });
  return { app, store, worker, catalog };
}
