import { randomUUID } from 'node:crypto';
import { parseJson, simpleResultSchema, subscriptionsSchema, userSchema, validateMessage, messageSchema } from './contracts.js';
import type { Config } from './config.js';
import { safeLink } from './data/contract.js';
import { Catalog } from './culture/catalog.js';
import type { DisplayRef } from './data/source-policy.js';
import { actorAllowed } from './admission.js';
import type { Storage } from './storage.js';

export type FailureKind = 'SEMANTIC' | 'MALFORMED' | 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'SERVER' | 'HTTP' | 'TIMEOUT_AMBIGUOUS' | 'TRANSPORT_AMBIGUOUS' | 'CANCELLED';
export class MaxError extends Error {
  request?: { path: '/me'|'/subscriptions'|'/updates'; deadlineMs: number; elapsedMs: number };
  constructor(public readonly kind: FailureKind, public readonly status?: number, public readonly retryAfterMs?: number) { super(kind); }
}
export type Button = { type: 'callback'; text: string; payload: string } | { type: 'link'; text: string; url: string };
export type MessageRequest = { text: string; notify?: boolean; attachments?: { type: 'inline_keyboard'; payload: { buttons: Button[][] } }[] };
export type MessageTarget = { mid: string; recipient: string; chat: string };
export type MaxOperation = ({ method: 'messages'; recipient: string; body: MessageRequest }
  | ({ method: 'edit'; body: MessageRequest } & MessageTarget)
  | ({ method: 'read' } & MessageTarget) | ({ method: 'delete' } & MessageTarget)
  | { method: 'answers'; callbackId: string; body: { notification: string } }) & {
    actor?:string; forgetAfterSend?:boolean; audience?: 'SYNTHETIC' | 'PROVIDER'; displayRefs?:DisplayRef[]; screen?: { epoch: string; revision: number; chat: string; purpose: string; previousMid?: string | null } };
export function deliveryAllowed(op:MaxOperation,config:Config,catalog:Catalog,now=Date.now()) {
  if(op.method==='read'||op.method==='delete')return true;
  if(op.audience==='SYNTHETIC')return config.flowDataMode==='synthetic-test';
  if(op.audience!=='PROVIDER')return true;
  if(op.method==='answers'||config.mode==='live'&&!actorAllowed(config,op.recipient))return false;
  return catalog.permits(op.displayRefs,now,config.admissionMode==='PUBLIC');
}
export function validateOperation(op: MaxOperation) {
  if (op.method === 'read' || op.method === 'delete') { if (!op.mid || !op.recipient || !op.chat) throw new MaxError('SEMANTIC'); return; }
  if (op.method === 'answers') { if (op.body.notification.length > 200) throw new MaxError('SEMANTIC'); return; }
  if (!op.body.text || op.body.text.length > 4000 || (op.body.attachments?.length ?? 0) > 1) throw new MaxError('SEMANTIC');
  if (op.method === 'edit' && (!op.mid || !op.recipient || !op.chat || !Array.isArray(op.body.attachments))) throw new MaxError('SEMANTIC');
  for (const a of op.body.attachments ?? []) {
    if (a.payload.buttons.length > 30) throw new MaxError('SEMANTIC');
    for (const row of a.payload.buttons) {
      if (row.length > (row.some(b => b.type === 'link') ? 3 : 7)) throw new MaxError('SEMANTIC');
      for (const b of row) if (!b.text || b.text.length > 80 || (b.type === 'link'
        ? b.url.length > 2048 || !safeLink(b.url) : Buffer.byteLength(b.payload) > 128)) throw new MaxError('SEMANTIC');
    }
  }
}
export type MaxResult = { simulated: boolean; mid?: string; chat?: string; message?: MessageRequest };
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
    const deadlineMs = options.deadlineMs ?? this.access.requestTimeoutMs, startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
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
      const failure = error instanceof MaxError ? error : new MaxError(options.signal?.aborted ? 'CANCELLED' : controller.signal.aborted ? 'TIMEOUT_AMBIGUOUS' : 'TRANSPORT_AMBIGUOUS');
      const route = path.split('?')[0];
      // Только фиксированные read-only пути; без query, marker, токена и ответа MAX.
      if (route === '/me' || route === '/subscriptions' || route === '/updates') failure.request = { path: route, deadlineMs, elapsedMs: Date.now() - startedAt };
      throw failure;
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
  private readonly catalog:Catalog;
  constructor(private readonly config:Config,fetcher:typeof fetch=fetch,private readonly signal?:AbortSignal,private readonly authorize?:(op:MaxOperation)=>boolean) {
    super(config,fetcher);
    this.catalog=Catalog.load(config);
    if(config.mode!=='live'||!config.token) throw new Error('LiveMax требует live-конфигурацию');
  }
  override async me() {return super.me(this.config.botId);}
  async execute(op: MaxOperation): Promise<MaxResult> {
    validateOperation(op);
    if(this.config.admissionMode==='PUBLIC'&&!this.authorize?.(op))throw new MaxError('PERMISSION');
    if (!deliveryAllowed(op,this.config,this.catalog)) throw new MaxError('PERMISSION');
    if (op.method === 'messages') {
      const raw = await this.request('POST', `/messages?user_id=${encodeURIComponent(op.recipient)}&disable_link_preview=true`, op.body, {signal:this.signal});
      const message = this.validate(() => validateMessage(raw, op.recipient));
      if (message.sender?.user_id !== this.config.botId || !message.sender.is_bot || (op.screen && message.recipient.chat_id !== op.screen.chat)) throw new MaxError('MALFORMED',200);
      return { simulated: false, mid: message.body!.mid, chat: message.recipient.chat_id ?? undefined };
    }
    if (op.method === 'read') {
      const raw = await this.request('GET', `/messages/${encodeURIComponent(op.mid)}`, undefined, {signal:this.signal});
      const message = this.validate(() => messageSchema.parse(raw));
      if (message.sender?.user_id !== this.config.botId || !message.sender.is_bot || message.recipient.chat_type !== 'dialog'
        || message.recipient.chat_id !== op.chat || message.recipient.user_id !== op.recipient || message.body?.mid !== op.mid) throw new MaxError('PERMISSION',200);
      return {simulated:false,mid:op.mid,chat:op.chat,message:{text:message.body.text??'',attachments:(message.body.attachments??[]) as MessageRequest['attachments']}};
    }
    if (op.method === 'edit' || op.method === 'delete') {
      const raw = await this.request(op.method === 'edit' ? 'PUT' : 'DELETE', `/messages?message_id=${encodeURIComponent(op.mid)}`,
        op.method === 'edit' ? {...op.body, notify:false} : undefined, {signal:this.signal});
      this.validate(() => { if (!simpleResultSchema.parse(raw).success) throw new MaxError('SEMANTIC',200); });
      return {simulated:false,mid:op.mid,chat:op.chat};
    }
    const raw = await this.request('POST', `/answers?callback_id=${encodeURIComponent(op.callbackId)}&disable_link_preview=true`, op.body, {signal:this.signal});
    this.validate(() => { if (!simpleResultSchema.parse(raw).success) throw new MaxError('SEMANTIC', 200); });
    return { simulated: false };
  }
  async subscribe(url: string, types: string[]) {
    if (this.config.ingress === 'test-polling'||this.config.ingress==='polling') throw Error('POLLING_SUBSCRIBE_FORBIDDEN');
    const raw = await this.request('POST', '/subscriptions', { url, update_types: types, secret: this.config.webhookSecret });
    this.validate(() => { if (!simpleResultSchema.parse(raw).success) throw new MaxError('SEMANTIC', 200); });
  }
}

// Нет fetch, токена или URL. Это маркированная симуляция, а не резервный live-транспорт.
export class LocalMax implements MaxTransport {
  readonly messages = new Map<string, {recipient:string;chat:string;body:MessageRequest}>();
  async execute(op: MaxOperation): Promise<MaxResult> {
    validateOperation(op);
    if (op.method === 'answers') return {simulated:true};
    if (op.method === 'messages') {
      const mid=`synthetic-${randomUUID()}`,chat=op.screen?.chat??op.recipient;
      this.messages.set(mid,{recipient:op.recipient,chat,body:structuredClone(op.body)}); return {simulated:true,mid,chat};
    }
    const message=this.messages.get(op.mid);
    if (!message) throw new MaxError('HTTP',404);
    if(message.recipient!==op.recipient||message.chat!==op.chat) throw new MaxError('PERMISSION',403);
    if(op.method==='read') return {simulated:true,mid:op.mid,chat:op.chat,message:structuredClone(message.body)};
    if(op.method==='edit') message.body=structuredClone(op.body); else this.messages.delete(op.mid);
    return {simulated:true,mid:op.mid,chat:op.chat};
  }
}
export function outboundAuthorization(config:Config,store:Storage) {
  return (op:MaxOperation)=> {
    const actor=op.actor;
    if(!actor||!actorAllowed(config,actor)||store.contact(actor)?.access_mask!==1)return false;
    if(op.method!=='answers'&&op.recipient!==actor)return false;
    if(op.method==='edit'||op.method==='read'||op.method==='delete') {
      const owned=store.db.prepare('SELECT 1 FROM ui_messages WHERE mid=? AND actor=? AND chat=?').get(op.mid,actor,op.chat);
      if(!owned)return false;
    }
    return true;
  };
}
export function createTransport(config: Config,store?:Storage): MaxTransport { return config.mode === 'local' ? new LocalMax() : new LiveMax(config,fetch,undefined,store?outboundAuthorization(config,store):undefined); }
