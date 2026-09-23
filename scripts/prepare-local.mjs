import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
// Только синтетические ID. Повторная подготовка не перезаписывает окружение.
const value = [
  'APP_MODE=local', 'HOST=127.0.0.1', 'PORT=3000', 'DATABASE_PATH=./runtime/probe.sqlite',
  `MAX_WEBHOOK_SECRET=${randomBytes(32).toString('hex')}`,
  'PROBE_TESTER_IDS=9007199254740993,9007199254740995', 'MAX_EXPECTED_BOT_ID=777',
  'PROBE_TTL_SECONDS=600', 'MAX_REQUEST_TIMEOUT_MS=5000', '',
].join('\n');
try { writeFileSync('.env.local', value, { flag: 'wx', mode: 0o600 }); console.log('Создан .env.local для изолированного технического теста. Секрет не выводится.'); }
catch (e) { if (e.code === 'EEXIST') console.log('.env.local уже существует и сохранён.'); else throw e; }
