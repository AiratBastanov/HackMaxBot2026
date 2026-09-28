import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Snapshot } from './contract.js';
import { sourceReviews } from './reviews.js';
import { publicFactsPolicies, publicBasis } from './public-facts-policy.js';

// Перечень проверяемых источников. Само наличие здесь не разрешает показ:
// нужны точный snapshot hash, source review, срок и разрешённая аудитория.
import { sources, institutionIds, type Institution } from './source-registry.js';
export { sources, type Institution } from './source-registry.js';
export const factualScope = 'title-period-session-venue-hours-tariff-admission-source';
export const snapshotDigest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function publicPolicyHash(source:string) {const p=publicFactsPolicies[source as keyof typeof publicFactsPolicies];return p?snapshotDigest({policy:p,basis:publicBasis}):null;}
export const reviewSchema = z.object({version:z.literal(1), scope:z.enum(['ADMITTED_TESTERS_FACTS','PUBLIC_FACTS']),
  factualScope:z.literal(factualScope), reviewedAt:z.string().datetime(),
  entries:z.array(z.object({snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),
    sources:z.array(z.enum(institutionIds)).min(1), basis:z.literal('institution-facts/1'),
    publicPolicyHashes:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/)).optional(),
    validUntil:z.string().datetime()}).strict()).min(1).max(institutionIds.length)}).strict();
export type Review = z.infer<typeof reviewSchema>;
export type DisplayRef = {snapshotHash:string;eventId:string};
// Проверка неизменяемых фактов и привязки review отдельно от допуска по часам.
// Подготовка может сравнивать устаревшие версии, но показ всегда вызывает reviewedSnapshot.
export function reviewedSnapshotIntegrity(s:Snapshot, review:Review|null,publicOnly=false) {
  if(s.mode!=='REAL_CATALOG'||!s.events.length||s.outcome==='FAILED'||!review)return false;
  if(publicOnly&&review.scope!=='PUBLIC_FACTS')return false;
  const entry=review.entries.find(e=>e.snapshotHash===snapshotDigest(s));
  if(review.scope==='PUBLIC_FACTS'&&(!entry||entry.sources.some(id=>!publicPolicyHash(id)||entry.publicPolicyHashes?.[id]!==publicPolicyHash(id))))return false;
  if(!entry||Date.parse(entry.validUntil)>Date.parse(s.retrievedAt)+s.freshnessHours*3600000)return false;
  return s.events.every(e=> {
    const source=sources[e.provider as Institution];
    return source && entry.sources.includes(e.provider as Institution) && s.scope.city===source.city
      && new URL(e.sourceUrl).origin===source.origin && e.sourceLabel===source.label
      && !sourceReviews.some(r=>r.eventId===e.id&&r.status==='QUARANTINED')
      && e.observations.every(o=>o.provenance&&o.retrievedAt);
  })&&s.venues.every(v=>v.observations.every(o=>o.provenance&&o.retrievedAt));
}
export function reviewedSnapshot(s:Snapshot, review:Review|null, now:number,publicOnly=false) {
  if(!reviewedSnapshotIntegrity(s,review,publicOnly)||!review)return false;
  const entry=review.entries.find(e=>e.snapshotHash===snapshotDigest(s))!;
  if(review.scope==='PUBLIC_FACTS'&&now>=Date.parse(publicBasis.validUntil))return false;
  if(now<Date.parse(review.reviewedAt)||now>=Date.parse(entry.validUntil)||now>=Date.parse(s.scope.end)||now<Date.parse(s.retrievedAt))return false;
  return [...s.events,...s.venues].every(v=>v.observations.every(o=>now>=Date.parse(o.retrievedAt!)&&now-Date.parse(o.retrievedAt!)<=s.freshnessHours*3600000));
}
export function permittedRefs(snapshots:readonly Snapshot[],review:Review|null,refs:DisplayRef[]|undefined,now:number,publicOnly=false) {
  return Boolean(refs?.length && refs.every(ref=>snapshots.some(s=>snapshotDigest(s)===ref.snapshotHash
    && reviewedSnapshot(s,review,now,publicOnly)&&s.events.some(e=>e.id===ref.eventId))));
}
