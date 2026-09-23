import { loadConfig } from './config.js';
import { createApp } from './app.js';

async function main() {
  const config = loadConfig(process.env);
  const runtime = createApp(config, { report: value => console.log(JSON.stringify(value)) });
  await runtime.app.listen({ port: config.port, host: config.host });
  runtime.worker.start();
  console.log(JSON.stringify({ operation: 'startup', mode: config.mode, port: config.port, message: 'Технический тест G1' }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 15000).unref();
    await runtime.app.close();
    clearTimeout(timeout);
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { void close(); });
}
main().catch(error => {
  // В startup выводятся только наши сообщения конфигурации, не вложенные fetch/SQLite errors.
  const safe = error instanceof Error && /^(Конфигурация:|Live требует|Локальный режим)/.test(error.message) ? error.message : 'Не удалось запустить G1: проверьте конфигурацию, порт и SQLite';
  console.error(JSON.stringify({ operation: 'startup', errorClass: 'STARTUP_FAILURE', message: safe }));
  process.exitCode = 1;
});
