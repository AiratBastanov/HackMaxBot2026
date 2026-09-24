import { spawn } from 'node:child_process';
import { DataError, allowedApiUrl } from './http.js';

// Альтернативный транспорт для Windows, где Node fetch может не установить
// соединение. Те же host allowlist, GET, TLS и общий reader/budget в BoundedClient.
export function curlTransport(remainingBytes: () => number): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const url = allowedApiUrl(String(input));
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', [
      '--disable', '--silent', '--show-error', '--proto', '=https', '--max-time', '20', '--connect-timeout', '18',
      '--max-filesize', String(Math.max(1, remainingBytes())), '--compressed', '--include',
      '--header', 'Accept: application/json', '--user-agent', 'CulturalPlan-Local/1.0', '--url', url.href,
    ], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let headers = Buffer.alloc(0), controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false, closed = false;
    const stop = () => child.kill();
    const fail = (error: Error) => {
      if (closed) return;
      closed = true;
      if (settled) controller?.error(error); else reject(error);
    };
    init?.signal?.addEventListener('abort', stop, { once: true });
    child.stderr.resume(); // Никаких произвольных тел/диагностики источника в журнале.
    child.on('error', () => fail(new DataError('CURL_UNAVAILABLE')));
    child.stdout.on('data', (chunk: Buffer) => {
      if (closed) return;
      if (settled) { controller!.enqueue(chunk); if ((controller!.desiredSize ?? 0) <= 0) child.stdout.pause(); return; }
      headers = Buffer.concat([headers, chunk]);
      const split = headers.indexOf('\r\n\r\n');
      if (split < 0) {
        if (headers.length > 65536) { fail(new DataError('HTTP_HEADERS_LIMIT')); stop(); }
        return;
      }
      const lines = headers.subarray(0, split).toString('latin1').split('\r\n');
      const status = Number(lines.shift()?.match(/^HTTP\/\S+ (\d{3})/)?.[1]);
      if (status < 200 || status > 599 || !Number.isInteger(status)) { fail(new DataError('HTTP_HEADERS')); stop(); return; }
      const values = new Headers();
      for (const line of lines) { const at = line.indexOf(':'); if (at > 0) values.append(line.slice(0, at), line.slice(at + 1).trim()); }
      // curl уже декодировал тело; Response не должен декодировать его повторно.
      values.delete('content-encoding'); values.delete('content-length');
      const body = new ReadableStream<Uint8Array>({
        start(c) { controller = c; }, pull() { child.stdout.resume(); }, cancel() { closed = true; stop(); },
      });
      settled = true;
      const initial = headers.subarray(split + 4); headers = Buffer.alloc(0);
      if (initial.length) controller!.enqueue(initial);
      resolve(new Response(status === 204 || status === 304 ? null : body, { status, headers: values }));
    });
    child.on('close', code => {
      init?.signal?.removeEventListener('abort', stop);
      if (closed) return;
      if (code !== 0 || !settled) fail(new DataError(code === 28 ? 'TIMEOUT' : 'CURL_FAILURE'));
      else { closed = true; controller!.close(); }
    });
    if (init?.signal?.aborted) stop();
  })) as typeof fetch;
}
