import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { parseUpdate } from './contracts.js';
import { readTesters } from './polling-config.js';

export class PairingWindow {
  readonly code = randomBytes(16).toString('hex');
  readonly expiresAt: number;
  private candidate?: string;
  private used = false;
  constructor(readonly botId: string, readonly openedAt = Date.now()) { this.expiresAt = openedAt + 120000; }
  // parseUpdate проверяет authenticated actor, направление, dialog и полный event.
  find(raw: unknown, now: number): string | undefined {
    const parsed = parseUpdate(raw, this.botId);
    if (this.used || this.candidate || now >= this.expiresAt || parsed.ignored || parsed.event.kind !== 'message_created'
      || parsed.event.timestamp < this.openedAt || parsed.event.timestamp > now) return;
    const text = (raw as {message:{body:{text?:string}}}).message.body.text?.trim() ?? '';
    const actual = Buffer.from(text), expected = Buffer.from(`/pair ${this.code}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? parsed.event.actor : undefined;
  }
  // Вызывается только после commit batch/cursor. Код уже нельзя применить повторно.
  bind(actor: string) { if (this.candidate || this.used) throw Error('PAIRING_REPLAY'); this.candidate = actor; }
  confirm(confirmed: boolean, now: number): string {
    if (this.used || !this.candidate || now >= this.expiresAt || !confirmed) { this.used = true; throw Error('PAIRING_NOT_CONFIRMED_OR_EXPIRED'); }
    this.used = true;
    return this.candidate;
  }
}

export function savePairedTester(botId: string, actor: string, file: string) {
  const testers = readTesters(botId, undefined, file); testers.add(actor);
  if (testers.size > 20) throw Error('TESTER_LIMIT');
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify({ botId, testers: [...testers] }), { flag: 'wx', mode: 0o600 });
  renameSync(temp, file);
}
