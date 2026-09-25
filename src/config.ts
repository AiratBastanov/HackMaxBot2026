import { readFileSync } from 'node:fs';
import { z } from 'zod';

const id = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(v => BigInt(v) <= 9223372036854775807n);
const envSchema = z.object({
  APP_MODE: z.enum(['local', 'live']),
  HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1),
  MAX_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/).refine(v => !v.includes('PLACEHOLDER')),
  MAX_API_BASE_URL: z.literal('https://platform-api2.max.ru').default('https://platform-api2.max.ru'),
  MAX_BOT_TOKEN: z.string().optional(),
  MAX_EXPECTED_BOT_ID: id.optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  PROBE_TESTER_IDS: z.string().min(1),
  PROBE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  MAX_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(5000),
  LIVE_SCOPE_CONFIRMED: z.enum(['true', 'false']).default('false'),
  FLOW_DATA_MODE: z.enum(['real', 'synthetic-test']).default('real'),
  DATA_SNAPSHOT_PATH: z.string().min(1).optional(),
  DATA_REVIEW_PATH: z.string().min(1).optional(),
  FLOW_TEST_CLOCK: z.string().datetime({offset:true}).optional(),
  PUBLIC_DISPLAY: z.literal('NOT_CLEARED').default('NOT_CLEARED'),
});

export type Config = {
  ingress?: 'webhook' | 'test-polling';
  mode: 'local' | 'live'; host: '127.0.0.1' | '0.0.0.0'; port: number;
  databasePath: string; webhookSecret?: string; apiBaseUrl: string;
  token?: string; botId: string; publicBaseUrl?: string; testers: ReadonlySet<string>;
  probeTtlMs: number; requestTimeoutMs: number;
  flowDataMode: 'real' | 'synthetic-test'; snapshotPath?: string; reviewPath?:string; flowTestClock?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  if (env.APP_INGRESS && env.APP_INGRESS !== 'webhook') throw Error('Конфигурация: для test-polling используйте live:poll');
  const values = { ...env };
  // Secrets могут поступать из отдельного read-only mount, а не из аргументов.
  for (const name of ['MAX_BOT_TOKEN', 'MAX_WEBHOOK_SECRET']) {
    if (env[`${name}_FILE`]) {
      if (env[name]) throw new Error(`Конфигурация: одновременно заданы ${name} и ${name}_FILE`);
      try { values[name] = readFileSync(env[`${name}_FILE`]!, 'utf8').trim(); }
      catch { throw new Error(`Конфигурация: не удалось прочитать ${name}_FILE`); }
    }
  }
  const parsed = envSchema.safeParse(values);
  if (!parsed.success) throw new Error(`Конфигурация: проверьте ${[...new Set(parsed.error.issues.map(i => i.path[0]))].join(', ')}`);
  const v = parsed.data;
  if (v.FLOW_TEST_CLOCK && v.FLOW_DATA_MODE !== 'synthetic-test') throw new Error('Конфигурация: FLOW_TEST_CLOCK требует synthetic-test');
  if(v.APP_MODE==='live'&&v.FLOW_TEST_CLOCK) throw new Error('Конфигурация: FLOW_TEST_CLOCK запрещён для реальных клиентов');
  const testerIds = v.PROBE_TESTER_IDS.split(',').map(s => s.trim());
  if (testerIds.length > 20 || testerIds.some(s => !id.safeParse(s).success)) throw new Error('Конфигурация: PROBE_TESTER_IDS');
  if (v.APP_MODE === 'local' && (v.MAX_BOT_TOKEN || v.PUBLIC_BASE_URL || v.LIVE_SCOPE_CONFIRMED === 'true')) {
    throw new Error('Локальный режим несовместим с live-параметрами');
  }
  if (v.APP_MODE === 'live') {
    if (!v.MAX_BOT_TOKEN || v.MAX_BOT_TOKEN.length < 16 || /\s|PLACEHOLDER/.test(v.MAX_BOT_TOKEN)) throw new Error('Конфигурация: MAX_BOT_TOKEN');
    if (!v.MAX_EXPECTED_BOT_ID || !v.PUBLIC_BASE_URL || v.LIVE_SCOPE_CONFIRMED !== 'true') {
      throw new Error('Live требует MAX_EXPECTED_BOT_ID, PUBLIC_BASE_URL и подтверждённый LIVE_SCOPE_CONFIRMED');
    }
    const u = new URL(v.PUBLIC_BASE_URL);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/' || /^(localhost|127\.|\[::1\])/.test(u.hostname) || u.hostname.endsWith('.invalid') || /placeholder/i.test(u.hostname)) {
      throw new Error('Конфигурация: PUBLIC_BASE_URL должен быть согласованным HTTPS origin на порту 443');
    }
  }
  return { ingress:'webhook', mode: v.APP_MODE, host: v.HOST, port: v.PORT, databasePath: v.DATABASE_PATH,
    webhookSecret: v.MAX_WEBHOOK_SECRET, apiBaseUrl: v.MAX_API_BASE_URL, token: v.MAX_BOT_TOKEN,
    botId: v.MAX_EXPECTED_BOT_ID ?? '777', publicBaseUrl: v.PUBLIC_BASE_URL?.replace(/\/$/, ''),
    testers: new Set(testerIds), probeTtlMs: v.PROBE_TTL_SECONDS * 1000, requestTimeoutMs: v.MAX_REQUEST_TIMEOUT_MS,
    flowDataMode: v.FLOW_DATA_MODE, snapshotPath: v.DATA_SNAPSHOT_PATH, reviewPath:v.DATA_REVIEW_PATH, flowTestClock: v.FLOW_TEST_CLOCK };
}

// Read-only /me и /subscriptions не требуют доступного deployment, webhook secret или testers.
export function loadInspectionConfig(env:NodeJS.ProcessEnv) {
  if(env.MAX_INSPECTION_SCOPE_CONFIRMED!=='true') throw Error('INSPECTION_SCOPE_NOT_CONFIRMED');
  if(env.MAX_BOT_TOKEN&&env.MAX_BOT_TOKEN_FILE) throw Error('INSPECTION_DUPLICATE_TOKEN');
  let token=env.MAX_BOT_TOKEN;
  if(env.MAX_BOT_TOKEN_FILE) {try {token=readFileSync(env.MAX_BOT_TOKEN_FILE,'utf8').trim();} catch {throw Error('INSPECTION_TOKEN_FILE');}}
  if(!token||token.length<16||/\s|PLACEHOLDER/.test(token)) throw Error('INSPECTION_TOKEN_REQUIRED');
  if(env.MAX_EXPECTED_BOT_ID&&!id.safeParse(env.MAX_EXPECTED_BOT_ID).success) throw Error('INSPECTION_BOT_ID_INVALID');
  return {token,apiBaseUrl:'https://platform-api2.max.ru',requestTimeoutMs:5000,expectedBotId:env.MAX_EXPECTED_BOT_ID};
}
