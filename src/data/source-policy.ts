import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Snapshot } from './contract.js';
import { sourceReviews } from './reviews.js';

// Решение проекта о минимальных фактах, не лицензия учреждения и не публичный запуск.
export const sources = {
  'kazan-kremlin': { origin:'https://kazan-kremlin.ru', city:'kzn', label:'Источник: Казанский Кремль', basis:'institution-facts/1' },
  mie: { origin:'https://m-i-e.ru', city:'ekb', label:'Источник: Музей истории Екатеринбурга', basis:'institution-facts/1' },
} as const;
export type Institution = keyof typeof sources;
export const factualScope = 'title-period-session-venue-hours-tariff-admission-source';
export const snapshotDigest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const reviewSchema = z.object({version:z.literal(1), scope:z.literal('ADMITTED_TESTERS_FACTS'),
  factualScope:z.literal(factualScope), reviewedAt:z.string().datetime(),
  entries:z.array(z.object({snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),
    sources:z.array(z.enum(['kazan-kremlin','mie'])).min(1), basis:z.literal('institution-facts/1'),
    validUntil:z.string().datetime()}).strict()).min(1).max(6)}).strict();
export type Review = z.infer<typeof reviewSchema>;
export type DisplayRef = {snapshotHash:string;eventId:string};
export function reviewedSnapshot(s:Snapshot, review:Review|null, now:number) {
  if(s.mode!=='REAL_CATALOG'||!s.events.length||s.outcome==='FAILED'||!review)return false;
  const entry=review.entries.find(e=>e.snapshotHash===snapshotDigest(s));
  if(!entry||now<Date.parse(review.reviewedAt)||now>=Date.parse(entry.validUntil)
    ||Date.parse(entry.validUntil)>Date.parse(s.retrievedAt)+s.freshnessHours*3600000
    ||now>=Date.parse(s.scope.end)||now<Date.parse(s.retrievedAt))return false;
  return s.events.every(e=> {
    const source=sources[e.provider as Institution];
    return source && entry.sources.includes(e.provider as Institution) && s.scope.city===source.city
      && new URL(e.sourceUrl).origin===source.origin && e.sourceLabel===source.label
      && !sourceReviews.some(r=>r.eventId===e.id&&r.status==='QUARANTINED')
      && e.observations.every(o=>o.provenance&&o.retrievedAt&&now>=Date.parse(o.retrievedAt)
        && now-Date.parse(o.retrievedAt)<=s.freshnessHours*3600000);
  })&&s.venues.every(v=>v.observations.every(o=>o.provenance&&o.retrievedAt&&now>=Date.parse(o.retrievedAt)&&now-Date.parse(o.retrievedAt)<=s.freshnessHours*3600000));
}
export function permittedRefs(snapshots:readonly Snapshot[],review:Review|null,refs:DisplayRef[]|undefined,now:number) {
  return Boolean(refs?.length && refs.every(ref=>snapshots.some(s=>snapshotDigest(s)===ref.snapshotHash
    && reviewedSnapshot(s,review,now)&&s.events.some(e=>e.id===ref.eventId))));
}
