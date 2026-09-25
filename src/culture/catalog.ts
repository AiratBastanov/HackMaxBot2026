import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { validateSnapshot, type Snapshot } from '../data/contract.js';
import { sourceReviews } from '../data/reviews.js';
import type { Config } from '../config.js';
import type { CityKey } from '../data/cities.js';

export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}
// Единственная граница чтения снимка. Замена целиком, без сети/SQLite и изменения дат.
export class Catalog {
  private value: Snapshot | null = null;
  private values = new Map<CityKey, Snapshot>();
  private hash = digest(null);
  constructor(readonly mode: Config['flowDataMode'], input: unknown = null) { this.replace(input); }
  get snapshot() { return this.value; }
  get version() { return this.hash; }
  forCity(city: CityKey) { return this.values.get(city) ?? null; }
  get availableCities() { return [...this.values.keys()]; }
  replace(input: unknown) {
    const bundle = input && typeof input === 'object' && 'snapshots' in input ? (input as {snapshots: unknown}).snapshots : input === null ? [] : [input];
    if (!Array.isArray(bundle) || bundle.length > 6) throw new Error('CATALOG_BUNDLE');
    const next = bundle.map(validateSnapshot);
    if (next.some(s => (s.mode === 'SYNTHETIC_FIXTURE') !== (this.mode === 'synthetic-test'))) throw new Error('CATALOG_MODE_MISMATCH');
    if (new Set(next.map(s => s.scope.city)).size !== next.length) throw new Error('CATALOG_DUPLICATE_CITY');
    this.values = new Map(next.map(s => [s.scope.city, freeze(s)]));
    this.value = this.values.get('kzn') ?? next[0] ?? null; this.hash = digest({ next, sourceReviews });
  }
  static load(config: Config) {
    if (!config.snapshotPath) return new Catalog(config.flowDataMode);
    try {
      if (statSync(config.snapshotPath).size > 16 * 1024 * 1024) throw new Error('CATALOG_SIZE');
      return new Catalog(config.flowDataMode, JSON.parse(readFileSync(config.snapshotPath, 'utf8')));
    } catch (e) {
      if (e instanceof Error && e.message === 'CATALOG_MODE_MISMATCH') throw e;
      return new Catalog(config.flowDataMode); // Ошибка/отсутствие — недоступность, никогда не synthetic fallback.
    }
  }
}
