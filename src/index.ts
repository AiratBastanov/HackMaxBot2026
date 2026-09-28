import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { LiveMax } from './max.js';
import { acquireConsumerLock } from './consumer-lock.js';
import { requirePreparedCatalog } from './catalog-prepare.js';

async function main() {
  const config = loadConfig(process.env);
  requirePreparedCatalog(config);
  // Только GET. Runtime не регистрирует webhook; identity проверяется до открытия БД/порта.
  if(config.mode==='live') await new LiveMax(config).me();
  const release = config.mode === 'live' ? await acquireConsumerLock(config.botId) : async () => {};
  let runtime: ReturnType<typeof createApp> | undefined;
  try {
    runtime = createApp(config, { report: value => console.log(JSON.stringify(value)) });
    await runtime.app.listen({ port: config.port, host: config.host });
  } catch (e) { await runtime?.app.close(); await release(); throw e; }
  runtime.worker.start();
  console.log(JSON.stringify({ operation: 'startup', mode: config.mode, dataMode: config.flowDataMode, port: config.port, message: 'Культурный план: локальный исследовательский прототип' }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 15000).unref();
    await runtime!.app.close();
    await release();
    clearTimeout(timeout);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void close(); });
}
main().catch(error => {
  // В startup выводятся только наши сообщения конфигурации, не вложенные fetch/SQLite errors.
  const safe = error instanceof Error && /^(Конфигурация:|Live требует|Локальный режим)/.test(error.message) ? error.message : 'Не удалось запустить Культурный план: проверьте конфигурацию, снимок, порт и SQLite';
  console.error(JSON.stringify({ operation: 'startup', errorClass: 'STARTUP_FAILURE', message: safe }));
  process.exitCode = 1;
});
