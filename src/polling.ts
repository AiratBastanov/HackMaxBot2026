import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { int64, subscribedTypes } from './contracts.js';
import { admitUpdate } from './admission.js';
import type { Config } from './config.js';
import { ReadOnlyMax, MaxError } from './max.js';
import { Storage } from './storage.js';
import type { PairingWindow } from './pairing.js';

export const POLL_LIMIT = 10;
export const POLL_TIMEOUT_SECONDS = 30;
export const POLL_DEADLINE_MS = 35000;
export const batchSchema = z.object({ updates: z.array(z.unknown()).max(POLL_LIMIT), marker: int64.nullish() });
export type PollBatch = { updates: unknown[]; marker: string | null };

export class PollingMax extends ReadOnlyMax {
  async updates(marker: string | null, signal: AbortSignal, initial = false): Promise<PollBatch> {
    if (marker !== null && (!/^-?(0|[1-9][0-9]*)$/.test(marker) || BigInt(marker) < -9223372036854775808n || BigInt(marker) > 9223372036854775807n)) throw Error('INVALID_STORED_MARKER');
    const query = new URLSearchParams({ limit: String(POLL_LIMIT), timeout: initial ? '0' : String(POLL_TIMEOUT_SECONDS), types: subscribedTypes.join(',') });
    if (marker !== null) query.set('marker', marker);
    const raw = await this.request('GET', `/updates?${query}`, undefined, { signal, deadlineMs: POLL_DEADLINE_MS });
    return this.validate(() => { const batch = batchSchema.parse(raw); return { updates: batch.updates, marker: batch.marker ?? null }; });
  }
}

export async function verifyPolling(max: Pick<ReadOnlyMax, 'me' | 'subscriptions'>, botId: string, exclusive: boolean, signal?: AbortSignal) {
  const bot = await max.me(botId, signal);
  if ((await max.subscriptions(signal)).length) throw Error('EXISTING_WEBHOOK_PRESERVED');
  if (!exclusive) throw Error('EXCLUSIVE_CONSUMER_CONFIRMATION_REQUIRED');
  return bot;
}

const campaignSchema = z.object({ id: z.string().uuid(), kind: z.enum(['session','pair']), startedAt: z.number().int(), deadline: z.number().int(),
  requests: z.number().int().min(0).max(120), lastRequestAt: z.number().int(), notBefore: z.number().int(), errors: z.number().int().min(0).max(3),
  snapshotVersion: z.string(), stopped: z.boolean(), sendError: z.string().nullable(), sendErrors: z.number().int().min(0).max(3) });
export type Campaign = z.infer<typeof campaignSchema>;
function saveCampaign(store: Storage, campaign: Campaign) { store.setMeta('poll_campaign', JSON.stringify(campaign)); }
export function openCampaign(store: Storage, command: 'start' | 'resume' | 'pair', snapshotVersion: string, now = Date.now(), minutes: 15 | 30 = 15): Campaign {
  if (![15,30].includes(minutes) || (minutes !== 15 && command !== 'start')) throw Error('EXPLICIT_START_DURATION_REQUIRED');
  const raw = store.getMeta('poll_campaign');
  const previous = raw ? campaignSchema.parse(JSON.parse(raw)) : undefined;
  if (command === 'resume') {
    if (!previous || previous.kind !== 'session' || previous.deadline <= now || previous.requests >= 120 || previous.stopped || previous.errors >= 3) throw Error('CAMPAIGN_NOT_RESUMABLE');
    if (previous.snapshotVersion !== snapshotVersion) throw Error('RESTART_SNAPSHOT_CHANGED');
    return previous;
  }
  if (previous?.kind === 'session' && previous.deadline > now && previous.requests < 120) throw Error('USE_RESUME_WITHIN_EXISTING_CAMPAIGN');
  const campaign: Campaign = { id: randomUUID(), kind: command === 'pair' ? 'pair' : 'session', startedAt: now,
    deadline: now + (command === 'pair' ? 120000 : minutes * 60000), requests: 0, lastRequestAt: 0, notBefore: 0, errors: 0, snapshotVersion, stopped: false, sendError:null,sendErrors:0 };
  saveCampaign(store, campaign); return campaign;
}

export function observeDelivery(store: Storage, campaign: Campaign, value: object): boolean {
  const row=value as {operation?:string;purpose?:string;errorClass?:string;result?:string};
  if(row.errorClass==='AUTH') {campaign.stopped=true;saveCampaign(store,campaign);return true;}
  if(!['messages','answers','edit'].includes(row.operation??'')||row.purpose==='culture_retire') return false;
  if(row.errorClass) {
    campaign.sendErrors=row.errorClass===campaign.sendError?Math.min(3,campaign.sendErrors+1):1;
    campaign.sendError=row.errorClass;
    if(['AUTH','PERMISSION'].includes(row.errorClass)||campaign.sendErrors>=3) campaign.stopped=true;
  } else if(row.result==='MAX_ACCEPTED') {campaign.sendErrors=0;campaign.sendError=null;}
  saveCampaign(store,campaign);return campaign.stopped;
}

export function commitBatch(store: Storage, config: Config, batch: PollBatch, now: number, pairing?: PairingWindow) {
  if (batch.marker === null && (store.pollingMarker() !== null || batch.updates.length > 0)) throw Error('NULL_MARKER_CANNOT_ADVANCE_BATCH');
  // Полный batch валидируется до первой записи. Нерелевантные события отличаются от повреждённых.
  const parsed = batch.updates.map(raw => admitUpdate(raw, config));
  const candidates = pairing ? batch.updates.map(raw => pairing.find(raw, now)).filter((v): v is string => !!v) : [];
  if (new Set(candidates).size > 1) throw Error('PAIRING_MULTIPLE_ACTORS');
  const events = pairing ? [] : parsed.flatMap(p => p.ignored ? [] : [p.event]);
  const counts = store.acceptPollBatch(events, batch.marker, now);
  if (candidates[0]) pairing!.bind(candidates[0]);
  return { ...counts, ignored: batch.updates.length - events.length, candidate: candidates[0] };
}

export async function runPolling(options: {
  max: Pick<PollingMax,'updates'|'subscriptions'>; store: Storage; config: Config; campaign?: Campaign; signal: AbortSignal;
  report?: (value: object) => void; ready?: () => void; pairing?: PairingWindow;
  clock?: () => number; wait?: (ms:number, signal:AbortSignal) => Promise<void>;
}) {
  const {max,store,config,signal,pairing} = options;
  if(pairing&&!options.campaign)throw Error('PAIRING_REQUIRES_TEST_CAMPAIGN');
  const clock = options.clock ?? Date.now, report = options.report ?? (() => {});
  const durable=store.getMeta('poll_runtime');
  const previous=durable?z.object({lastRequestAt:z.number(),notBefore:z.number()}).parse(JSON.parse(durable)):undefined;
  const campaign:Campaign=options.campaign??{id:randomUUID(),kind:'session',startedAt:clock(),deadline:Infinity,
    requests:0,lastRequestAt:previous?.lastRequestAt??0,notBefore:previous?.notBefore??0,errors:0,snapshotVersion:'runtime',stopped:false,sendError:null,sendErrors:0};
  const save=()=>options.campaign?saveCampaign(store,campaign):store.setMeta('poll_runtime',JSON.stringify({lastRequestAt:campaign.lastRequestAt,notBefore:campaign.notBefore}));
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, {signal}));
  let ready = false;
  const announce = () => { if (!ready) { ready = true; options.ready?.(); } };
  if (store.getMeta('poll_marker') !== undefined) announce();
  while (!signal.aborted && clock() < campaign.deadline && campaign.requests < (options.campaign?120:Infinity) && !campaign.stopped) {
    try {
      const waitMs = Math.max(0, campaign.lastRequestAt + 1000 - clock(), campaign.notBefore - clock());
      if (clock() + waitMs >= campaign.deadline) break;
      if (waitMs) await wait(waitMs, signal);
      if (signal.aborted || clock() >= campaign.deadline) break;
      if (store.getMeta('auth_blocked') === 'true') throw new MaxError('AUTH');
      if ((await max.subscriptions(signal)).length) throw Error('EXISTING_WEBHOOK_PRESERVED');
      if (signal.aborted || clock() >= campaign.deadline) break;
      campaign.requests++; campaign.lastRequestAt = clock();
      // Резервировать попытку ДО сети: crash не восстанавливает израсходованный бюджет.
      save();
      const batch = await max.updates(store.pollingMarker(), signal, !ready);
      report({operation:'poll_api_receipt',result:'SUCCESS',events:batch.updates.length,request:campaign.requests});
      if (signal.aborted) break;
      const result = commitBatch(store, config, batch, clock(), pairing);
      campaign.errors = 0; campaign.notBefore = 0; save();
      report({operation:'poll_commit',accepted:result.accepted,duplicate:result.duplicate,ignored:result.ignored});
      announce();
      if (result.candidate) return result.candidate;
    } catch (error) {
      if (signal.aborted) break;
      campaign.errors++;
      const retryable = error instanceof MaxError && ['SERVER','RATE_LIMIT','TIMEOUT_AMBIGUOUS','TRANSPORT_AMBIGUOUS'].includes(error.kind);
      campaign.stopped = !retryable || campaign.errors >= 3;
      campaign.notBefore = clock() + Math.max(error instanceof MaxError ? error.retryAfterMs ?? 0 : 0, 2000 * 2 ** (campaign.errors - 1));
      save();
      report({operation:'poll_error',errorClass:error instanceof MaxError ? error.kind : 'BATCH_OR_CONSUMER_FAILURE',attempts:campaign.errors});
      if (campaign.stopped) throw error;
    }
  }
}
