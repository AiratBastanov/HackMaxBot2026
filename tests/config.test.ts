import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { ACTOR, SECRET } from './fixtures.js';
import { pollingTiming } from '../src/polling-timeout.js';

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
  for (const url of [undefined,'http://probe.example.org', 'https://probe.example.org:8443', 'https://x:y@probe.example.org', 'https://probe.example.org/path', 'https://localhost','https://PLACEHOLDER_APPROVED_HOST']) assert.throws(() => loadConfig({ ...v, PUBLIC_BASE_URL: url }));
  assert.equal(loadConfig({...v,APP_INGRESS:'webhook'}).ingress,'webhook');
  assert.throws(()=>loadConfig({...v,APP_INGRESS:'test-polling'}));
});
test('Ошибка конфигурации не раскрывает секрет', () => {
  const secret = 'secret with private characters';
  assert.throws(() => loadConfig({ ...local, MAX_WEBHOOK_SECRET: secret }), e => e instanceof Error && !e.message.includes(secret));
});

test('Обычный timeout остаётся 100..10000 мс; polling 0..90 с всегда имеет больший deadline', () => {
  const defaults = loadConfig(local);
  assert.equal(defaults.requestTimeoutMs, 5000);
  assert.deepEqual(pollingTiming(defaults.pollTimeoutSeconds), { serverTimeoutSeconds: 30, clientDeadlineMs: 35000 });
  for (const ms of ['100', '10000']) assert.equal(loadConfig({ ...local, MAX_REQUEST_TIMEOUT_MS: ms }).requestTimeoutMs, Number(ms));
  for (const ms of ['99', '10001', '45000']) assert.throws(() => loadConfig({ ...local, MAX_REQUEST_TIMEOUT_MS: ms }), /MAX_REQUEST_TIMEOUT_MS/);
  for (const seconds of ['0', '1', '30', '90']) {
    const c = loadConfig({ ...local, MAX_POLL_TIMEOUT_SECONDS: seconds });
    const timing = pollingTiming(c.pollTimeoutSeconds);
    assert.equal(timing.serverTimeoutSeconds, Number(seconds));
    assert.equal(timing.clientDeadlineMs, Number(seconds) * 1000 + 5000);
    assert(timing.clientDeadlineMs > timing.serverTimeoutSeconds * 1000);
  }
  for (const seconds of ['-1', '91', '1.5', 'NaN', 'Infinity']) {
    assert.throws(() => loadConfig({ ...local, MAX_POLL_TIMEOUT_SECONDS: seconds }), /MAX_POLL_TIMEOUT_SECONDS/);
    assert.throws(() => pollingTiming(Number(seconds)));
  }
});
