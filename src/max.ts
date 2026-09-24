import { randomUUID } from 'node:crypto';
import { parseJson, simpleResultSchema, subscriptionsSchema, userSchema, validateMessage } from './contracts.js';
import type { Config } from './config.js';
import { safeLink } from './data/contract.js';

export type FailureKind = 'SEMANTIC' | 'MALFORMED' | 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'SERVER' | 'HTTP' | 'TIMEOUT_AMBIGUOUS' | 'TRANSPORT_AMBIGUOUS' | 'CANCELLED';
export class MaxError extends Error {
  constructor(public readonly kind: FailureKind, public readonly status?: number, public readonly retryAfterMs?: number) { super(kind); }
}
export type Button = { type: 'callback'; text: string; payload: string } | { type: 'link'; text: string; url: string };
export type MessageRequest = { text: string; notify?: boolean; attachments?: { type: 'inline_keyboard'; payload: { buttons: Button[][] } }[] };
export type MaxOperation = ({ method: 'messages'; recipient: string; body: MessageRequest } | { method: 'answers'; callbackId: string; body: { notification: string } }) & { audience?: 'SYNTHETIC' | 'PROVIDER' };
export function validateOperation(op: MaxOperation) {
  if (op.method === 'answers') { if (op.body.notification.length > 200) throw new MaxError('SEMANTIC'); return; }
  if (!op.body.text || op.body.text.length > 4000 || (op.body.attachments?.length ?? 0) > 1) throw new MaxError('SEMANTIC');
  for (const a of op.body.attachments ?? []) {
    if (a.payload.buttons.length > 30) throw new MaxError('SEMANTIC');
    for (const row of a.payload.buttons) {
      if (row.length > (row.some(b => b.type === 'link') ? 3 : 7)) throw new MaxError('SEMANTIC');
      for (const b of row) if (!b.text || b.text.length > 80 || (b.type === 'link'
        ? b.url.length > 2048 || !safeLink(b.url) : Buffer.byteLength(b.payload) > 128)) throw new MaxError('SEMANTIC');
    }
  }
}
export type MaxResult = { simulated: boolean; mid?: string };
export interface MaxTransport { execute(operation: MaxOperation): Promise<MaxResult> }

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  const delay = Number.isFinite(n) && n >= 0 ? n * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export class ReadOnlyMax {
  constructor(private readonly access:Pick<Config,'token'|'apiBaseUrl'|'requestTimeoutMs'>, private readonly fetcher: typeof fetch = fetch) {
    if(!access.token) throw Error('MAX_TOKEN_REQUIRED');
  }
  protected async request(method: string, path: string, body?: unknown, options: { deadlineMs?: number; signal?: AbortSignal } = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? this.access.requestTimeoutMs);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      signal.throwIfAborted();
      const response = await this.fetcher(`${this.access.apiBaseUrl}${path}`, {
        method, redirect: 'error', signal,
        headers: { Authorization: this.access.token!, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        const kind: FailureKind = response.status === 401 ? 'AUTH' : response.status === 403 ? 'PERMISSION' : response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'SERVER' : 'HTTP';
        throw new MaxError(kind, response.status, retryAfter(response.headers.get('retry-after')));
      }
      // Deadline охватывает и чтение тела. Ограничение защищает от бесконечного/большого ответа.
      const reader = response.body?.getReader();
      if (!reader) throw new MaxError('MALFORMED', 200);
      const abortReader = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', abortReader, {once:true});
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > 262144) { await reader.cancel(); throw new MaxError('MALFORMED', 200); }
        chunks.push(value);
      }
      } finally { signal.removeEventListener('abort', abortReader); reader.releaseLock(); }
      try { return parseJson(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new MaxError('MALFORMED', 200); }
    } catch (error) {
      if (error instanceof MaxError) throw error;
      throw new MaxError(options.signal?.aborted ? 'CANCELLED' : controller.signal.aborted ? 'TIMEOUT_AMBIGUOUS' : 'TRANSPORT_AMBIGUOUS');
    } finally { clearTimeout(timer); }
  }
  protected validate<T>(fn: () => T): T {
    try { return fn(); } catch (e) { if (e instanceof MaxError) throw e; throw new MaxError('MALFORMED', 200); }
  }
  async me(expectedBotId?:string, signal?: AbortSignal) {
    const raw=await this.request('GET','/me',undefined,{signal});
    return this.validate(()=>{const bot=userSchema.parse(raw);if(!bot.is_bot||(expectedBotId&&bot.user_id!==expectedBotId)) throw new MaxError('AUTH',200);return bot;});
  }
  async subscriptions(signal?: AbortSignal) {
    const raw=await this.request('GET','/subscriptions',undefined,{signal});
    return this.validate(()=>subscriptionsSchema.parse(raw).subscriptions);
  }
}
export class LiveMax extends ReadOnlyMax implements MaxTransport {
  constructor(private readonly config:Config,fetcher:typeof fetch=fetch,private readonly signal?:AbortSignal) {
    super(config,fetcher);
    if(config.mode!=='live'||!config.token) throw new Error('LiveMax требует live-конфигурацию');
  }
  override async me() {return super.me(this.config.botId);}
  async execute(op: MaxOperation): Promise<MaxResult> {
    validateOperation(op);
    if (op.audience === 'PROVIDER' || (op.audience === 'SYNTHETIC' && this.config.flowDataMode !== 'synthetic-test')) throw new MaxError('PERMISSION');
    if (op.method === 'messages') {
      const raw = await this.request('POST', `/messages?user_id=${encodeURIComponent(op.recipient)}&disable_link_preview=true`, op.body, {signal:this.signal});
      const message = this.validate(() => validateMessage(raw, op.recipient));
      return { simulated: false, mid: message.body!.mid };
    }
    const raw = await this.request('POST', `/answers?callback_id=${encodeURIComponent(op.callbackId)}&disable_link_preview=true`, op.body, {signal:this.signal});
    this.validate(() => { if (!simpleResultSchema.parse(raw).success) throw new MaxError('SEMANTIC', 200); });
    return { simulated: false };
  }
  async subscribe(url: string, types: string[]) {
    if (this.config.ingress === 'test-polling') throw Error('POLLING_SUBSCRIBE_FORBIDDEN');
    const raw = await this.request('POST', '/subscriptions', { url, update_types: types, secret: this.config.webhookSecret });
    this.validate(() => { if (!simpleResultSchema.parse(raw).success) throw new MaxError('SEMANTIC', 200); });
  }
}

// Нет fetch, токена или URL. Это маркированная симуляция, а не резервный live-транспорт.
export class LocalMax implements MaxTransport {
  async execute(op: MaxOperation): Promise<MaxResult> {
    validateOperation(op);
    return { simulated: true, ...(op.method === 'messages' ? { mid: `synthetic-${randomUUID()}` } : {}) };
  }
}
export function createTransport(config: Config): MaxTransport { return config.mode === 'local' ? new LocalMax() : new LiveMax(config); }
