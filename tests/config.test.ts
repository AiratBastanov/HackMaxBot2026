import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { ACTOR, SECRET } from './fixtures.js';

const local = { APP_MODE: 'local', DATABASE_PATH: ':memory:', MAX_WEBHOOK_SECRET: SECRET, PROBE_TESTER_IDS: ACTOR };
test('Локальная конфигурация работает без live credentials и хранит ID строкой', () => {
  const c = loadConfig(local); assert.equal(c.mode, 'local'); assert(c.testers.has(ACTOR)); assert.equal(c.host, '127.0.0.1');
});
for (const [name, patch] of Object.entries({
  'режим обязателен': { APP_MODE: undefined }, 'secret обязателен': { MAX_WEBHOOK_SECRET: undefined },
  'ID не округляется/не приводится из exponent': { PROBE_TESTER_IDS: '9e15' },
  'ID вне int64': { PROBE_TESTER_IDS: '9223372036854775808' }, 'порт ограничен': { PORT: '0' },
  'TTL ограничен': { PROBE_TTL_SECONDS: '3600' }, 'старый домен запрещён': { MAX_API_BASE_URL: 'https://platform-api.max.ru' },
  'live токен запрещён в local': { MAX_BOT_TOKEN: 'synthetic-token-not-live' },
  'live не подменяется mock': { APP_MODE: 'live' },
})) test(name, () => assert.throws(() => loadConfig({ ...local, ...patch })));
test('Live требует полную конфигурацию и подтверждение области теста', () => {
  const v = { ...local, APP_MODE: 'live', MAX_BOT_TOKEN: 'synthetic-contract-token', MAX_EXPECTED_BOT_ID: '777', PUBLIC_BASE_URL: 'https://probe.example.org', LIVE_SCOPE_CONFIRMED: 'true' };
  assert.equal(loadConfig(v).mode, 'live');
  for (const url of ['http://probe.example.org', 'https://probe.example.org:8443', 'https://x:y@probe.example.org', 'https://probe.example.org/path', 'https://localhost']) assert.throws(() => loadConfig({ ...v, PUBLIC_BASE_URL: url }));
});
test('Ошибка конфигурации не раскрывает секрет', () => {
  const secret = 'secret with private characters';
  assert.throws(() => loadConfig({ ...local, MAX_WEBHOOK_SECRET: secret }), e => e instanceof Error && !e.message.includes(secret));
});
