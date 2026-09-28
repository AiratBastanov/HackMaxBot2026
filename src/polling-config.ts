import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { loadInspectionConfig, type Config } from './config.js';
import { Catalog } from './culture/catalog.js';
import { pollingTiming } from './polling-timeout.js';

export const testerId = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
export const testRoot = resolve('runtime/max-test');
export const testerFile = resolve(testRoot, 'testers.json');

export function replacementAccess(env: NodeJS.ProcessEnv) {
  // Подтверждение оператора, а не автоматическое доказательство ротации на стороне MAX.
  if (env.MAX_CREDENTIAL_ROTATION_CONFIRMED !== 'true') throw Error('CREDENTIAL_LOCAL_SETUP_OR_ROTATION_PENDING');
  if (env.MAX_BOT_TOKEN || !env.MAX_BOT_TOKEN_FILE || resolve(env.MAX_BOT_TOKEN_FILE) !== resolve('secrets/max_bot_token')) throw Error('DESIGNATED_TOKEN_FILE_REQUIRED');
  return loadInspectionConfig({ ...env, MAX_INSPECTION_SCOPE_CONFIRMED: 'true' });
}

export function readTesters(botId: string, configured?: string, file = testerFile): Set<string> {
  const ids = configured?.trim() ? configured.split(',').map(v => v.trim()) : [];
  if (existsSync(file)) {
    const saved = z.object({ botId: testerId, testers: z.array(testerId).max(20) }).parse(JSON.parse(readFileSync(file, 'utf8')));
    if (saved.botId !== botId) throw Error('TESTER_FILE_BOT_MISMATCH');
    ids.push(...saved.testers);
  }
  if (ids.length > 20 || ids.some(v => !testerId.safeParse(v).success)) throw Error('TESTER_IDS_INVALID');
  return new Set(ids);
}

export function loadPollingConfig(env: NodeJS.ProcessEnv, pairing = false, options: {access?:typeof replacementAccess; testerPath?:string} = {}): Config {
  if (env.APP_MODE !== 'live' || env.APP_INGRESS !== 'test-polling' || !['real','synthetic-test'].includes(env.FLOW_DATA_MODE??'')
    || env.PUBLIC_DISPLAY !== 'NOT_CLEARED' || env.LIVE_SCOPE_CONFIRMED !== 'true') throw Error('TEST_POLLING_CONFIGURATION_REQUIRED');
  if (env.PUBLIC_BASE_URL || env.MAX_WEBHOOK_SECRET || env.MAX_WEBHOOK_SECRET_FILE || env.FLOW_TEST_CLOCK) throw Error('POLLING_WEBHOOK_OR_CLOCK_FORBIDDEN');
  if (!testerId.safeParse(env.MAX_EXPECTED_BOT_ID).success) throw Error('PINNED_BOT_ID_REQUIRED');
  const botId = env.MAX_EXPECTED_BOT_ID!;
  const databasePath = resolve(testRoot, `${botId}.sqlite`);
  if (env.DATABASE_PATH && resolve(env.DATABASE_PATH) !== databasePath) throw Error('DEDICATED_TEST_DATABASE_REQUIRED');
  const snapshotPath = env.DATA_SNAPSHOT_PATH ? resolve(env.DATA_SNAPSHOT_PATH) : undefined;
  if (!snapshotPath || !(snapshotPath.startsWith(testRoot + sep) || env.FLOW_DATA_MODE==='real'&&snapshotPath.startsWith(resolve('catalog/real')+sep)) || !snapshotPath.endsWith('.json')) throw Error('TEST_SNAPSHOT_PATH_REQUIRED');
  const reviewPath=env.DATA_REVIEW_PATH?resolve(env.DATA_REVIEW_PATH):undefined;
  if(env.FLOW_DATA_MODE==='real'&&reviewPath&&!reviewPath.startsWith(resolve('catalog/real')+sep)&&!reviewPath.startsWith(testRoot+sep))throw Error('REVIEW_PATH_REQUIRED');
  const testers = readTesters(botId, env.PROBE_TESTER_IDS, options.testerPath);
  if (!pairing && !testers.size) throw Error('CONSENTING_TESTER_OR_PAIRING_REQUIRED');
  const timeout = Number(env.MAX_REQUEST_TIMEOUT_MS ?? 5000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10000) throw Error('POST_TIMEOUT_INVALID');
  const access = (options.access ?? replacementAccess)(env);
  return { mode: 'live', ingress: 'test-polling', host: '127.0.0.1', port: 3000, databasePath,
    apiBaseUrl: access.apiBaseUrl, token: access.token, botId, testers, probeTtlMs: 600000,
    requestTimeoutMs: timeout, pollTimeoutSeconds: pollingTiming(env.MAX_POLL_TIMEOUT_SECONDS).serverTimeoutSeconds,
    flowDataMode: env.FLOW_DATA_MODE as Config['flowDataMode'], snapshotPath,reviewPath };
}

export function loadCurrentSynthetic(config: Config, now = Date.now()) {
  const catalog = Catalog.load(config);
  if (!catalog.availableCities.length || catalog.availableCities.some(city=>{
    const snapshot=catalog.forCity(city)!,age=now-Date.parse(snapshot.retrievedAt);
    return snapshot.mode!=='SYNTHETIC_FIXTURE'||!Number.isFinite(age)||age<0||age>3600000;
  })) throw Error('FRESH_SYNTHETIC_CURRENT_REQUIRED');
  return catalog;
}
export function loadCurrentCatalog(config:Config,now=Date.now()) {
  if(config.flowDataMode==='synthetic-test')return loadCurrentSynthetic(config,now);
  const catalog=Catalog.load(config);
  if(!catalog.usableCities(now).length||catalog.snapshots.some(s=>s.mode!=='REAL_CATALOG'))throw Error('REVIEWED_CURRENT_REAL_CATALOG_REQUIRED');
  return catalog;
}
