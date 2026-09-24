import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { atomicJson, readJson, readSnapshot, writeSnapshot } from '../src/data/cache.js';
import { BoundedClient, type NetworkLedger } from '../src/data/http.js';
import { curlTransport } from '../src/data/curl.js';
import { fetchKudago, validateDownload } from '../src/data/kudago.js';
import { checkTimepad } from '../src/data/timepad.js';
import { normalizeKudago } from '../src/data/normalize.js';
import { select } from '../src/data/select.js';
import { representativeQueries, syntheticClock, syntheticSnapshot } from '../src/data/examples.js';
import { runEnrichmentCampaign } from '../src/data/enrich.js';

const [command, ...args] = process.argv.slice(2);
const supported = ['--cache', '--snapshot', '--query', '--clock', '--transport', '--resume', '--check-timepad', '--synthetic', '--expanded', '--city-places', '--include-uncertain', '--plan'];
const options = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const key = args[i]!;
  if (!supported.includes(key) || options.has(key)) throw new Error(`Неизвестный/повторный аргумент: ${key}`);
  if (['--check-timepad', '--synthetic', '--expanded', '--city-places', '--include-uncertain'].includes(key)) options.set(key, 'true');
  else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Нет значения: ${key}`); options.set(key, value); }
}
const cache = resolve(options.get('--cache') ?? '.cache/cultural-plan');
const path = resolve(options.get('--snapshot') ?? join(cache, 'snapshot.json'));
const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function explicitClock(): Date {
  const input = options.get('--clock');
  if (!input || !z.string().datetime({ offset: true }).safeParse(input).success) throw new Error('Нужны явные --clock с ISO-8601 и часовым поясом.');
  return new Date(input);
}
async function run() {
  if (command === 'fetch' || command === 'enrich') {
    if (options.has('--clock') || options.has('--synthetic')) throw new Error('Живой fetch использует фактическое время, синтетика запрещена.');
    const transport = options.get('--transport') ?? 'native';
    if (!['native', 'curl'].includes(transport)) throw new Error('Транспорт: native или curl.');
    await mkdir(cache, { recursive: true });
    const lockPath = join(cache, 'fetch.lock'), lock = await open(lockPath, 'wx');
    try {
      if (command === 'enrich') {
        if (!options.has('--resume') || !options.has('--plan')) throw new Error('enrich требует --resume и --plan с обоснованными ID существующих записей.');
        if (options.has('--check-timepad') || options.has('--city-places') || options.has('--expanded')) throw new Error('Кампания enrich использует только точечный план KudaGo.');
        const previous = validateDownload(await readJson(options.get('--resume')!));
        const abort = new AbortController(), cancel = () => abort.abort();
        process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
        try {
          const state = await runEnrichmentCampaign(join(cache, 'enrichment-campaign.json'), previous,
            await readJson(options.get('--plan')!), transport as 'native' | 'curl', async download => {
              await atomicJson(join(cache, 'kudago-download.json'), download);
              await writeSnapshot(path, normalizeKudago(download));
            }, abort.signal);
          print({ outcome: 'ENRICHMENT_FINISHED', startedAt: state.startedAt, finishedAt: state.finishedAt,
            steps: state.steps, network: { requests: state.ledger.requests.length, decodedBytes: state.ledger.decodedBytes } });
          if (state.steps.some(s => s.outcome !== 'OK')) process.exitCode = 2;
        } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
        return;
      }
      let ledger: NetworkLedger = { requests: [], decodedBytes: 0 };
      const ledgerPath = join(cache, 'network-ledger.json');
      try { ledger = z.object({ requests: z.array(z.object({ url: z.string().url(), startedAt: z.string(), status: z.number().nullable(),
        bytes: z.number().nonnegative(), outcome: z.string() })), decodedBytes: z.number().nonnegative() }).parse(await readJson(ledgerPath)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const client = new BoundedClient(ledger, value => atomicJson(ledgerPath, value),
        transport === 'curl' ? curlTransport(() => 16 * 1024 * 1024 - ledger.decodedBytes) : fetch);
      const previous = options.has('--resume') ? validateDownload(await readJson(options.get('--resume')!)) : undefined;
      const download = await fetchKudago(client, new Date(), previous, options.has('--expanded'));
      await atomicJson(join(cache, `download-${Date.now()}.json`), download);
      // Не теряем успешный provider payload при неудаче следующего шага.
      if (download.events.complete || !previous?.events.complete)
        await atomicJson(join(cache, 'kudago-download.json'), download);
      const snapshot = normalizeKudago(download), saved = await writeSnapshot(path, snapshot);
      let timepad;
      if (options.has('--check-timepad')) { timepad = await checkTimepad(client, download.window); await atomicJson(join(cache, 'timepad-check.json'), timepad); }
      print({ outcome: snapshot.outcome, scope: snapshot.scope, stats: snapshot.stats, issues: snapshot.issues, cache: saved,
        network: { requests: ledger.requests.length, decodedBytes: ledger.decodedBytes },
        ...(timepad ? { timepad: { ...timepad, rows: timepad.rows.length } } : {}) });
      if (snapshot.outcome !== 'COMPLETE') process.exitCode = 2;
    } finally { await lock.close(); await unlink(lockPath); }
  } else if (command === 'normalize') {
    const input = options.get('--resume'); if (!input) throw new Error('Нужен --resume <kudago-download.json>.');
    const snapshot = normalizeKudago(validateDownload(await readJson(input)), options.has('--synthetic') ? 'SYNTHETIC_FIXTURE' : 'LIVE_PUBLIC');
    const saved = await writeSnapshot(path, snapshot); print({ outcome: snapshot.outcome, stats: snapshot.stats, cache: saved });
  } else if (command === 'validate') {
    const snapshot = await readSnapshot(path);
    print({ valid: true, mode: snapshot.mode, outcome: snapshot.outcome, scope: snapshot.scope,
      retrievedAt: snapshot.retrievedAt, stats: snapshot.stats });
  } else if (command === 'recommend') {
    const file = options.get('--query'); if (!file) throw new Error('Нужен --query <json>.');
    let snapshot = null;
    try { snapshot = await readSnapshot(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    print(select(snapshot, await readJson(file), explicitClock(), options.has('--synthetic'), options.has('--include-uncertain')));
  } else if (command === 'examples') {
    const clock = explicitClock(), queries = representativeQueries(clock);
    let snapshot = null;
    try { snapshot = await readSnapshot(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    print({ clock: clock.toISOString(), results: Object.fromEntries(Object.entries(queries).map(([name, query]) => [name,
      { query, result: select(snapshot, query, clock, options.has('--synthetic'), options.has('--include-uncertain')) }])) });
  } else if (command === 'demo') {
    if (!options.has('--synthetic')) throw new Error('Демо требует явный --synthetic.');
    const snapshot = syntheticSnapshot();
    const queries = representativeQueries(syntheticClock);
    await atomicJson(join(cache, 'synthetic.snapshot.json'), snapshot);
    await atomicJson(join(cache, 'synthetic.query.json'), queries.weekend500);
    print({ mode: 'SYNTHETIC_FIXTURE', clock: syntheticClock.toISOString(), results: Object.fromEntries(Object.entries(queries)
      .map(([name, query]) => [name, { query, result: select(snapshot, query, syntheticClock, true) }])) });
  } else throw new Error('Команды: fetch, enrich, normalize, validate, recommend, examples, demo. Инструкция: docs/pivot/06_DATA_MODULE_RECEIPT.md');
}
run().catch(error => { print({ status: 'ERROR', reason: error instanceof z.ZodError ? 'SCHEMA_VALIDATION_FAILED' : String(error.message) }); process.exitCode = 1; });
