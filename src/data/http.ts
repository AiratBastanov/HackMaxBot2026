import { setTimeout as delay } from 'node:timers/promises';

export type RequestRecord = { url: string; startedAt: string; status: number | null; bytes: number; outcome: string;
  finishedAt?: string; elapsedMs?: number; retry?: boolean };
export type NetworkLedger = { requests: RequestRecord[]; decodedBytes: number };
export type NetworkLimits = { requests: number; bytes: number; timeoutMs: number; spacingMs: number; operationMs: number;
  deadlineAt?: number; maxRetries?: number };
export interface JsonClient { get(url: string, retry?: boolean): Promise<unknown> }
export class DataError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function allowedApiUrl(value: string): URL {
  const url = new URL(value);
  const allowed = url.hostname === 'kudago.com'
    ? /^\/public-api\/v1\.4\/(events|event-categories|locations|places)\/(?:[a-z0-9-]+\/)?$/.test(url.pathname)
    : url.hostname === 'api.timepad.ru' && url.pathname === '/v1/events.json';
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
    throw new DataError('UNSAFE_API_URL');
  return url;
}

// Один экземпляр на операцию; очередь распространяется и на параллельных вызывающих.
// fetch декодирует content-encoding; учитываем именно прочитанные decoded bytes.
export class BoundedClient implements JsonClient {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStarts = new Map<string, number>();
  private deniedHosts = new Set<string>();
  private readonly operationDeadline: number;
  constructor(
    readonly ledger: NetworkLedger = { requests: [], decodedBytes: 0 },
    private readonly persist: (ledger: NetworkLedger) => Promise<void> = async () => {},
    private readonly transport: typeof fetch = fetch,
    private readonly limits: NetworkLimits = { requests: 24, bytes: 16 * 1024 * 1024, timeoutMs: 20000, spacingMs: 1000, operationMs: 55000 },
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<unknown> = delay,
    private readonly signal?: AbortSignal,
  ) {
    this.operationDeadline = Math.min(this.now() + limits.operationMs, limits.deadlineAt ?? Infinity);
    for (const row of ledger.requests) {
      const host = new URL(row.url).hostname;
      if (Number.isFinite(Date.parse(row.startedAt))) this.lastStarts.set(host, Date.parse(row.startedAt));
      if (row.status === 401 || row.status === 403) this.deniedHosts.add(host);
    }
  }
  get(value: string, retry = false): Promise<unknown> {
    const run = this.tail.then(() => this.run(value, retry));
    this.tail = run.catch(() => {});
    return run;
  }
  private async run(value: string, retry: boolean): Promise<unknown> {
    const url = allowedApiUrl(value);
    const failures = this.ledger.requests.filter(r => r.url === url.href && r.outcome !== 'OK');
    if (failures.length >= 2) throw new DataError('RETRY_LIMIT');
    const deadline = this.operationDeadline;
    for (let attempt = 0; ; attempt++) {
      if (this.signal?.aborted) throw new DataError('CANCELLED');
      if (this.deniedHosts.has(url.hostname)) throw new DataError('CREDENTIALS_REQUIRED');
      if (this.ledger.requests.length >= this.limits.requests || this.ledger.decodedBytes >= this.limits.bytes)
        throw new DataError('NETWORK_BUDGET');
      const wait = Math.max(0, (this.lastStarts.get(url.hostname) ?? 0) + this.limits.spacingMs - this.now());
      if (this.now() + wait + this.limits.timeoutMs > deadline) throw new DataError('OPERATION_DEADLINE');
      await this.sleep(wait);
      if (this.signal?.aborted) throw new DataError('CANCELLED');
      const start = this.now();
      this.lastStarts.set(url.hostname, start);
      const row: RequestRecord = { url: url.href, startedAt: new Date(start).toISOString(), status: null, bytes: 0, outcome: 'STARTED' };
      if (attempt > 0) row.retry = true;
      this.ledger.requests.push(row);
      await this.persist(this.ledger); // Резервируем запрос до обращения к сети.
      const abort = new AbortController();
      const cancel = () => abort.abort();
      this.signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => abort.abort(), Math.max(0, Math.min(this.limits.timeoutMs - (this.now() - start), deadline - this.now())));
      let retryAfter = 0;
      try {
        if (this.signal?.aborted) throw new DataError('CANCELLED');
        if (this.now() - start >= this.limits.timeoutMs) throw new DataError('TIMEOUT');
        const response = await this.transport(url, { method: 'GET', redirect: 'error', signal: abort.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'CulturalPlan-Local/1.0' }, credentials: 'omit' });
        row.status = response.status;
        if (response.status === 401 || response.status === 403) this.deniedHosts.add(url.hostname);
        const header = response.headers.get('retry-after');
        if (header) retryAfter = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - this.now());
        const chunks: Uint8Array[] = [];
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              row.bytes += part.value.byteLength;
              this.ledger.decodedBytes += part.value.byteLength;
              if (this.ledger.decodedBytes > this.limits.bytes) {
                abort.abort(); await reader.cancel(); throw new DataError('BODY_BUDGET');
              }
              chunks.push(part.value);
            }
          } finally { reader.releaseLock(); }
        }
        if (response.status === 401 || response.status === 403) {
          this.deniedHosts.add(url.hostname); throw new DataError('CREDENTIALS_OR_ACCESS_DENIED');
        }
        if (!response.ok) throw new DataError(`HTTP_${response.status}`);
        if (!/application\/(?:[\w.-]+\+)?json/i.test(response.headers.get('content-type') ?? ''))
          throw new DataError('NON_JSON_200');
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new DataError('MALFORMED_JSON'); }
        row.outcome = 'OK';
        return parsed;
      } catch (error) {
        const code = error instanceof DataError && error.code === 'BODY_BUDGET' ? error.code
          : this.signal?.aborted ? 'CANCELLED' : this.now() >= deadline ? 'OPERATION_DEADLINE'
          : abort.signal.aborted ? 'TIMEOUT' : error instanceof DataError ? error.code : 'NETWORK_FAILURE';
        row.outcome = code;
        // Только явно разрешённый один повтор временного GET; schema/401/403 не повторяются.
        const transient = ['TIMEOUT', 'NETWORK_FAILURE', 'HTTP_429', 'HTTP_502', 'HTTP_503', 'HTTP_504'].includes(code);
        if (!retry || attempt > 0 || this.ledger.requests.filter(r => r.retry).length >= (this.limits.maxRetries ?? 1)
          || !transient || !Number.isFinite(retryAfter)
          || this.now() + Math.max(retryAfter, 1000) + this.limits.timeoutMs > deadline) throw new DataError(code);
      } finally {
        clearTimeout(timer); this.signal?.removeEventListener('abort', cancel);
        row.finishedAt = new Date(this.now()).toISOString(); row.elapsedMs = this.now() - start;
        await this.persist(this.ledger);
      }
      await this.sleep(Math.max(retryAfter, 1000));
    }
  }
}
