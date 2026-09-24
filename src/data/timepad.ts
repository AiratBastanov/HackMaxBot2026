import { z } from 'zod';
import { DataError, type JsonClient } from './http.js';

// Ровно одна публичная проверка; без Authorization и без broad example filters.
// Адаптер нормализации включается только после доказательства полезности и условий.
export async function checkTimepad(client: JsonClient, window: { start: string; end: string }) {
  const url = new URL('https://api.timepad.ru/v1/events.json');
  url.search = new URLSearchParams({ cities: 'Казань', starts_at_min: window.start, starts_at_max: window.end,
    moderation_statuses: 'featured', limit: '5', sort: '+id',
    fields: 'id,name,url,starts_at,ends_at,location,categories,organization' }).toString();
  try {
    const result = z.object({ total: z.number().int().nonnegative(), values: z.array(z.unknown()) }).parse(await client.get(url.href));
    return { status: 'EVALUATED' as const, total: result.total, rows: result.values,
      reason: result.values.length ? 'REQUIRES_USEFULNESS_AND_TERMS_REVIEW' : 'NO_APPROVED_PUBLIC_RECORDS' };
  } catch (error) {
    return { status: 'SKIPPED' as const, total: null, rows: [], reason: error instanceof DataError ? error.code : 'PROVIDER_SCHEMA' };
  }
}
