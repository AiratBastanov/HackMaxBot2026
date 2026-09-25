import { open, readFile, rename, unlink, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateSnapshot, type Snapshot } from './contract.js';

export async function readJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('CACHE_SIZE');
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function readSnapshot(path: string): Promise<Snapshot> { return validateSnapshot(await readJson(path)); }
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx');
  try {
    try { await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8'); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, path);
  }
  finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function writeSnapshot(path: string, candidate: unknown) {
  const next = validateSnapshot(candidate);
  await mkdir(dirname(path), { recursive: true });
  const lock = await open(`${path}.lock`, 'wx');
  try {
    let current: Snapshot | null = null;
    try { current = await readSnapshot(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await atomicJson(`${path}.attempt.json`, next);
    const enrichment = current && next.retrievedAt === current.retrievedAt && next.enrichedAt !== null
      && Date.parse(next.enrichedAt) > Date.parse(current.enrichedAt ?? '1970-01-01T00:00:00Z')
      && current.events.every(e => next.events.some(n => n.id === e.id));
    const reason = current && current.scope.city !== next.scope.city ? 'CITY_MISMATCH'
      : current && current.mode !== next.mode ? 'MODE_MISMATCH'
      : current && Date.parse(next.retrievedAt) < Date.parse(current.retrievedAt) ? 'OLDER_REFRESH'
      : next.outcome === 'FAILED' ? 'FAILED_REFRESH'
      : current?.outcome === 'COMPLETE' && next.outcome !== 'COMPLETE' && !enrichment ? 'INCOMPLETE_REFRESH'
      : current?.events.length && !next.events.length ? 'EMPTY_REFRESH' : null;
    if (reason) return { replaced: false, reason, active: current !== null, attempt: `${path}.attempt.json` };
    await atomicJson(path, next);
    return { replaced: true, reason: null, active: true, attempt: `${path}.attempt.json` };
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
