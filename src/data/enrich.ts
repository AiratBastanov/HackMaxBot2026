import { z } from 'zod';
import { BoundedClient, DataError, type JsonClient, type NetworkLedger } from './http.js';
import { curlTransport } from './curl.js';
import { atomicJson, readJson } from './cache.js';
import { addObservation, base, eventFields, eventSchema, placeFields, placeSchema, validateDownload, type KudaDownload } from './kudago.js';

export const enrichmentPlanSchema = z.array(z.object({ entity: z.enum(['event', 'place']), id: z.number().int().positive(),
  reason: z.string().min(10).max(500) }).strict()).min(1).max(12);
export type EnrichmentPlan = z.infer<typeof enrichmentPlanSchema>;
export type EnrichmentStep = { entity: 'event' | 'place'; id: number; outcome: string };
export const enrichmentLimits = { requests: 12, bytes: 8 * 1024 * 1024, timeoutMs: 20000, spacingMs: 1000, operationMs: 240000, maxRetries: 1 };

// Один общий журнал кампании, checkpoint после каждого результата; повтор CLI
// продолжает прежний deadline и счётчики, завершённую кампанию не запускает заново.
export async function enrichTargeted(client: JsonClient, previous: KudaDownload, plan: EnrichmentPlan,
  checkpoint: (download: KudaDownload, steps: EnrichmentStep[]) => Promise<void>, steps: EnrichmentStep[] = [],
  now: () => Date = () => new Date()): Promise<KudaDownload> {
  const result = structuredClone(previous);
  const eventIds = new Set(result.events.rows.map(e => e.id));
  const placeIds = new Set(result.events.rows.flatMap(e => e.place ? [e.place.id] : []));
  for (const item of enrichmentPlanSchema.parse(plan)) {
    if (!(item.entity === 'event' ? eventIds : placeIds).has(item.id)) throw new DataError('ENRICHMENT_ID_OUTSIDE_DOWNLOAD');
  }
  for (const item of plan) {
    if (steps.some(s => s.entity === item.entity && s.id === item.id)) continue;
    const failures = steps.filter(s => s.entity === item.entity && !['OK', 'ROUTE_STOPPED'].includes(s.outcome));
    if (failures.some(f => failures.filter(g => g.outcome === f.outcome).length >= 2)) {
      steps.push({ entity: item.entity, id: item.id, outcome: 'ROUTE_STOPPED' }); await checkpoint(result, steps); continue;
    }
    const url = new URL(`${base}${item.entity === 'event' ? 'events' : 'places'}/${item.id}/`);
    url.search = new URLSearchParams(item.entity === 'event' ? { fields: eventFields, expand: 'dates,place' }
      : { fields: placeFields }).toString();
    try {
      const payload = await client.get(url.href);
      if (item.entity === 'event') {
        const data = eventSchema.parse(payload);
        if (data.id !== item.id) throw new DataError('EVENT_ID_MISMATCH');
        addObservation(result, { entity: 'event', data, requestUrl: url.href, retrievedAt: now().toISOString() });
      } else {
        const data = placeSchema.parse(payload);
        if (data.id !== item.id) throw new DataError('PLACE_ID_MISMATCH');
        addObservation(result, { entity: 'place', data, requestUrl: url.href, retrievedAt: now().toISOString() });
        result.places.retrieved++;
      }
      steps.push({ entity: item.entity, id: item.id, outcome: 'OK' });
    } catch (error) {
      const outcome = error instanceof DataError ? error.code : error instanceof z.ZodError ? 'PROVIDER_SCHEMA' : 'ENRICHMENT_FAILURE';
      steps.push({ entity: item.entity, id: item.id, outcome });
      result.issues.push(outcome);
      await checkpoint(result, steps);
      if (['CANCELLED', 'OPERATION_DEADLINE', 'NETWORK_BUDGET', 'BODY_BUDGET', 'CREDENTIALS_REQUIRED', 'CREDENTIALS_OR_ACCESS_DENIED'].includes(outcome)) break;
      continue;
    }
    result.places.complete = [...placeIds].every(id => result.places.rows.some(p => p.id === id));
    await checkpoint(result, steps);
  }
  return result;
}

export async function runEnrichmentCampaign(path: string, previous: KudaDownload, inputPlan: unknown,
  transport: 'native' | 'curl', save: (download: KudaDownload) => Promise<void>, signal?: AbortSignal) {
  const plan = enrichmentPlanSchema.parse(inputPlan), now = new Date();
  const ledgerSchema = z.object({ requests: z.array(z.object({ url: z.string().url(), startedAt: z.string().datetime(),
    status: z.number().nullable(), bytes: z.number().nonnegative(), outcome: z.string(), finishedAt: z.string().optional(),
    elapsedMs: z.number().optional(), retry: z.boolean().optional() })), decodedBytes: z.number().nonnegative() });
  let state = { version: 1, startedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + 240000).toISOString(),
    finishedAt: null as string | null, plan, ledger: { requests: [], decodedBytes: 0 } as NetworkLedger,
    download: previous, steps: [] as EnrichmentStep[] };
  try {
    const old = z.object({ version: z.literal(1), startedAt: z.string().datetime(), deadlineAt: z.string().datetime(),
      finishedAt: z.string().datetime().nullable(), plan: enrichmentPlanSchema, ledger: ledgerSchema, download: z.unknown(),
      steps: z.array(z.object({ entity: z.enum(['event', 'place']), id: z.number(), outcome: z.string() })) }).parse(await readJson(path));
    if (JSON.stringify(old.plan) !== JSON.stringify(plan)) throw new DataError('CAMPAIGN_PLAN_CHANGED');
    state = { ...old, download: validateDownload(old.download) };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (state.finishedAt) { await save(state.download); return state; }
  await atomicJson(path, state);
  const client = new BoundedClient(state.ledger, async () => atomicJson(path, state),
    transport === 'curl' ? curlTransport(() => enrichmentLimits.bytes - state.ledger.decodedBytes) : fetch,
    { ...enrichmentLimits, deadlineAt: Date.parse(state.deadlineAt) }, Date.now, undefined, signal);
  state.download = await enrichTargeted(client, state.download, plan, async (download, steps) => {
    state.download = download; state.steps = steps;
    await atomicJson(path, state); // Прежде следующего запроса и нормализации.
    await save(download);
  }, state.steps);
  state.finishedAt = new Date().toISOString(); await atomicJson(path, state); await save(state.download);
  return state;
}
